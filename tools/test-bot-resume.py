"""本地验证投稿机器人的下载逻辑：对着一个"会掐断连接"的服务器跑 probe_video。

用 Blender/UE 自带的 CPython 跑（本机没有系统 Python）：
    <python> tools-test-bot.py http://127.0.0.1:8901/x.mp4

期望：前两轮被掐断（各收到 1 MB），第三轮 Range 续传后拿到完整文件，
      并且 sha256/字节数与真实文件一致。
"""
import hashlib
import importlib.util
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / ".github" / "scripts" / "process_submission.py"

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8901/x.mp4"

spec = importlib.util.spec_from_file_location("process_submission", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)          # 有 __main__ 守卫，import 不会执行主流程

print("MAX_BYTES =", mod.MAX_BYTES // 1024 // 1024, "MB")
print("MAX_ATTEMPTS =", mod.MAX_ATTEMPTS, " READ_TIMEOUT =", mod.READ_TIMEOUT)

t0 = time.time()
info = mod.probe_video(url)
elapsed = time.time() - t0

print("下载完成，用时 %.1f 秒" % elapsed)
print("bytes   =", info["bytes"])
print("sha256  =", info["sha256"])
print("width   =", info["width"], " height =", info["height"], " duration =", info["duration"])

expected_hash = "1e365711e3af07478112c502e93ac5a8072f6dae541f207d6cc8061f12a4ef6a"
ok = info["bytes"] == 3252011 and info["sha256"] == expected_hash
print("RESULT:", "PASS 续传后拿到完整且哈希正确的文件" if ok else "FAIL 字节或哈希不符")

# 也验证一下本地那份原文件的哈希，确认期望值本身没错
raw = Path(r"C:\Users\高振杰\AppData\Local\Temp\ba-test\real.mp4")
if raw.exists():
    h = hashlib.sha256(raw.read_bytes()).hexdigest()
    print("本地原文件 sha256 一致性:", h == expected_hash)
