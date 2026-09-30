"""把本地视频文件上传到社区仓库的托管 Release（`assets-v1`）。

用的是机器人自己的 rehost() —— 所以产出的地址、资产命名、去重行为与真实投稿完全一致。

    python tools/upload-to-hosting.py "<本地文件>" [--id <条目id>] [--name <显示名>] [--author <作者>]

条目 id 决定资产名（纯 ASCII，遵守那个 Release 的约定）。不传就按
`<author小写>__<author小写>-<sha8>` 推断（与机器人的 derive_slug 一致）。
"""
import argparse
import hashlib
import importlib.util
import os
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SCRIPT = ROOT / ".github" / "scripts" / "process_submission.py"

ap = argparse.ArgumentParser()
ap.add_argument("file")
ap.add_argument("--id", dest="entry_id", default="")
ap.add_argument("--name", default="")
ap.add_argument("--author", default="NativeDog1")
args = ap.parse_args()

path = Path(args.file)
if not path.exists():
    print("找不到文件:", path)
    sys.exit(2)

token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
if not token:
    print("缺少 GH_TOKEN")
    sys.exit(2)
os.environ.setdefault("GITHUB_REPOSITORY", "NativeDog1/-Boot-Animation-Community-")

spec = importlib.util.spec_from_file_location("process_submission", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

data_len = path.stat().st_size
print("文件:", path.name, data_len, "字节（%.1f MB）" % (data_len / 1048576))
print("计算 sha256（流式）…")
h = hashlib.sha256()
with path.open("rb") as fh:
    while True:
        block = fh.read(1 << 20)
        if not block:
            break
        h.update(block)
sha = h.hexdigest()
print("sha256:", sha)

entry_id = args.entry_id
if not entry_id:
    slug = ("%s-%s" % (args.author, sha[:8])).lower()
    slug = re.sub(r"[^a-z0-9_-]+", "-", slug).strip("-")[:41]
    entry_id = "%s__%s" % (args.author.lower(), slug)
display = args.name or path.stem
print("资产名 →", mod.asset_name(entry_id, {"filename": path.name}))
print("条目 id →", entry_id)

url = mod.rehost(entry_id, display, args.author,
                 {"path": str(path), "bytes": data_len, "sha256": sha, "filename": path.name},
                 "(本地手动上传)")
if not url:
    print("RESULT: FAIL 上传失败")
    sys.exit(1)
print("托管地址:", url)

# 校验：能公开下载、字节数一致、并且支持 Range（客户端续传要用）
req = urllib.request.Request(url, method="HEAD")
req.add_header("User-Agent", "boot-anim-bot")
with urllib.request.urlopen(req, timeout=120) as r:
    size = int(r.headers.get("content-length") or 0)
    print("HEAD:", r.status, "content-length =", size, "（期望 %d）" % data_len)

req2 = urllib.request.Request(url)
req2.add_header("User-Agent", "boot-anim-bot")
req2.add_header("Range", "bytes=%d-%d" % (data_len - 1024, data_len - 1))
with urllib.request.urlopen(req2, timeout=120) as r2:
    tail = r2.read()
    print("Range 请求:", r2.status, "拿到", len(tail), "字节（期望 1024）→ 支持续传:", r2.status == 206)

ok = size == data_len
print("RESULT:", "PASS 已托管且可公开下载" if ok else "FAIL 字节数不符")
sys.exit(0 if ok else 1)
