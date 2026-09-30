"""真跑一次「分片拼回」。

覆盖三件事：
  1. 清单格式与浏览器端（split.js）**逐字段一致** —— 直接读 JS 那边的固定样本；
  2. 把真实视频切成 3 片，用测试服务器提供它们，让 reassemble_parts() 拼回来并与原文件哈希比对；
  3. 顺序颠倒时必须被 sha256 拒绝（这是整套方案唯一的正确性保障）。

自包含：脚本自己起 node 测试服务器（目录模式、不掐断）并在结束时关掉。
    python tools/test-parts.py
"""
import hashlib
import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / ".github" / "scripts" / "process_submission.py"
VIDEO = Path(os.environ["TEMP"]) / "ba-test" / "real.mp4"
PORT = int(os.environ.get("PORT") or 8902)
SERVER = Path(os.environ.get("SERVE_TEST")
              or (HERE.parent.parent / "boot-animation-app" / "tools" / "serve-test.mjs"))

spec = importlib.util.spec_from_file_location("process_submission", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

fails = []

# ── 1. 清单契约（与 split.js 共用一个样本文件）
fixture = (HERE / "fixtures" / "parts-manifest.txt").read_text(encoding="utf-8").strip()
meta = mod.parse_parts_manifest(fixture)
expect = {
    "name": "cyber-neon-4k.mp4",
    "bytes": 209715200,
    "parts": 10,
    "partbytes": 20971520,
    "sha256": "9f2c1b7e4d8a6f3051c9e2b7a4d6f8013c5e9b2d7a4f6c8103e5b9d2f7a4c6e8",
}
print("解析固定样本:", meta)
if meta != expect:
    fails.append("清单解析与 JS 端的样本不一致")

for bad in ["", "hello", fixture.replace("parts=10", "parts=0"),
            fixture.replace("bytes=209715200", "bytes=0"),
            fixture.replace("sha256=", "sha256=zz"),
            "ba-parts:v2;" + fixture.split(";", 1)[1]]:
    if mod.parse_parts_manifest(bad) is not None:
        fails.append("坏清单没被拒绝: %r" % bad[:40])
print("坏输入检查:", "通过" if not fails else "有问题")

# ── 2 & 3. 真拼 + 顺序颠倒
if not VIDEO.exists():
    fails.append("缺少测试视频 %s" % VIDEO)
else:
    data = VIDEO.read_bytes()
    part_size = 1024 * 1024
    chunks = [data[i:i + part_size] for i in range(0, len(data), part_size)]
    work = Path(tempfile.mkdtemp())
    names = []
    for i, chunk in enumerate(chunks, 1):
        name = "p%02dof%02d.mp4" % (i, len(chunks))
        (work / name).write_bytes(chunk)
        names.append(name)
    print("切了 %d 片：%s（每片 %d 字节，最后一片 %d）"
          % (len(chunks), ", ".join(names), part_size, len(chunks[-1])))

    manifest = {
        "name": "selftest.mp4",
        "bytes": len(data),
        "parts": len(chunks),
        "partbytes": part_size,
        "sha256": hashlib.sha256(data).hexdigest(),
    }
    urls = ["http://127.0.0.1:%d/%s" % (PORT, n) for n in names]

    if not SERVER.exists():
        fails.append("找不到测试服务器 %s（可用 SERVE_TEST 环境变量指定）" % SERVER)
        print("RESULT:", "FAIL " + "; ".join(fails))
        sys.exit(1)

    server = subprocess.Popen(
        ["node", str(SERVER), str(work), str(PORT), "0"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        # 等服务起来
        ready = False
        for _ in range(40):
            try:
                with urllib.request.urlopen(urls[0], timeout=2) as r:
                    if r.status == 200:
                        ready = True
                        break
            except Exception:
                time.sleep(0.25)
        if not ready:
            fails.append("测试服务器没起来")
            raise SystemExit(0)

        try:
            info = mod.reassemble_parts(urls, manifest)
            print("拼回结果：bytes=%d sha256=%s 分辨率=%sx%s 时长=%.2f"
                  % (info["bytes"], info["sha256"][:16], info["width"], info["height"], info["duration"]))
            if info["bytes"] != manifest["bytes"]:
                fails.append("拼回字节数不对")
            if info["sha256"] != manifest["sha256"]:
                fails.append("拼回哈希不对")
            if info["width"] != 1280 or info["height"] != 720:
                fails.append("拼回后 ffprobe 读不出正确分辨率（%sx%s）" % (info["width"], info["height"]))
        except SystemExit as e:
            fails.append("拼回过程 fail() 了：见 .github/last-error.txt（exit %s）" % e.code)

        # 顺序颠倒必须被拒
        try:
            mod.reassemble_parts(list(reversed(urls)), manifest)
            fails.append("顺序颠倒竟然通过了 —— 那 sha256 校验就形同虚设")
        except SystemExit:
            err = HERE.parent / ".github" / "last-error.txt"
            msg = err.read_text(encoding="utf-8") if err.exists() else ""
            print("顺序颠倒被拒（符合预期）。原因：", msg.splitlines()[0][:80] if msg else "(无)")
            if ("sha256" not in msg) and ("顺序" not in msg):
                fails.append("拒绝理由不是哈希不符：%s" % msg[:80])
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except Exception:
            server.kill()
        shutil.rmtree(work, ignore_errors=True)

print("RESULT:", "PASS" if not fails else "FAIL " + "; ".join(fails))
sys.exit(0 if not fails else 1)
