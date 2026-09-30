"""真跑一次 rehost：把文件传进社区仓库**既有的** assets-v1 托管 Release，验证直链可下。

跑完只删掉本次上传的资产，不碰那个 release 和它原有的内容。
需要 GH_TOKEN 环境变量：
    python tools/test-rehost.py
"""
import importlib.util
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / ".github" / "scripts" / "process_submission.py"
VIDEO = Path(os.environ["TEMP"]) / "ba-test" / "real.mp4"
ENTRY_ID = "selftest__rehost-check"
REPO = os.environ.get("GITHUB_REPOSITORY") or "NativeDog1/-Boot-Animation-Community-"
os.environ["GITHUB_REPOSITORY"] = REPO
TOKEN = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""

if not TOKEN:
    print("缺少 GH_TOKEN")
    sys.exit(2)
if not VIDEO.exists():
    print("缺少测试视频:", VIDEO)
    sys.exit(2)

spec = importlib.util.spec_from_file_location("process_submission", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

HOSTING_TAG = mod.HOSTING_TAG
print("托管 Release =", HOSTING_TAG, " 资产名规则 →", mod.asset_name(ENTRY_ID, {"filename": "x.MP4"}))


def api(method, path):
    req = urllib.request.Request("https://api.github.com" + path, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "boot-anim-bot")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


before = api("GET", "/repos/%s/releases/tags/%s" % (REPO, HOSTING_TAG))
before_names = sorted(a["name"] for a in (before or {}).get("assets") or [])
print("上传前 assets-v1 里的资产:", before_names)

info = {"path": str(VIDEO), "bytes": VIDEO.stat().st_size, "sha256": "0" * 64, "filename": "selftest.mp4"}
url = mod.rehost(ENTRY_ID, "REHOST SELFTEST（跑完会删）", "selftest", info, "https://example.com/original.mp4")
print("返回的托管直链:", url)

ok = False
if url:
    req = urllib.request.Request(url, method="HEAD")
    req.add_header("User-Agent", "boot-anim-bot")
    with urllib.request.urlopen(req, timeout=60) as r:
        size = int(r.headers.get("content-length") or 0)
        ok = r.status == 200 and size == info["bytes"]
        print("HTTP", r.status, "content-length =", size, " expect =", info["bytes"])

after = api("GET", "/repos/%s/releases/tags/%s" % (REPO, HOSTING_TAG))
after_names = sorted(a["name"] for a in (after or {}).get("assets") or [])
print("上传后 assets-v1 里的资产:", after_names)
print("没有新建 release（仍是同一个）:", (after or {}).get("id") == (before or {}).get("id"))
print("RESULT:", "PASS 代管进既有托管 Release 且直链可下载" if ok else "FAIL")

# ── cleanup：只删本次上传的资产
for a in (after or {}).get("assets") or []:
    if a["name"] not in before_names:
        api("DELETE", "/repos/%s/releases/assets/%d" % (REPO, a["id"]))
        print("已删除本次上传的测试资产:", a["name"])
final = api("GET", "/repos/%s/releases/tags/%s" % (REPO, HOSTING_TAG))
print("清理后 assets-v1 里的资产:", sorted(x["name"] for x in (final or {}).get("assets") or []))
sys.exit(0 if ok else 1)
