"""手动上架一条投稿 —— 跑的是**同一个机器人**（.github/scripts/process_submission.py），
只是输入不是 Issue 正文，而是命令行参数。维护者自己传了文件、或想补上架时用。

    python tools/publish-one.py --url <直链> --name "ROG 开机动画" [--tags a,b] \
        [--license "自创，允许自由转载"] [--nsfw 否] [--author NativeDog1] [--rehost]

文件已经在社区托管里（assets-v1）时**不要**加 --rehost：否则会把几十 MB 再传一遍。
不加 --rehost 时机器人的 video 就指向你给的直链（前提是它本来就是社区托管地址）。
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SCRIPT = ROOT / ".github" / "scripts" / "process_submission.py"

ap = argparse.ArgumentParser()
ap.add_argument("--url", required=True)
ap.add_argument("--name", required=True)
ap.add_argument("--tags", default="")
ap.add_argument("--license", default="自创，允许自由转载")
ap.add_argument("--nsfw", default="否")
ap.add_argument("--author", default="NativeDog1")
ap.add_argument("--rehost", action="store_true", help="让机器人把视频搬进托管 Release（会重新上传）")
args = ap.parse_args()

body = "\n".join([
    "### 视频", "", args.url, "",
    "### 分片信息", "", "",
    "### 名称", "", args.name, "",
    "### 标签", "", args.tags, "",
    "### 授权方式", "", args.license, "",
    "### 是否含不适宜内容", "", args.nsfw, "",
    "### 声明", "",
    "- [X] 我确认我拥有该视频的权利或已获得授权，且内容不含违法、色情、暴力或仇恨内容",
    "- [X] 我理解本目录采取「自助投稿 + 事后下架」；上架后视频由社区仓库托管",
])

env = dict(os.environ)
env["ISSUE_BODY"] = body
env["ISSUE_USER"] = args.author
env["GITHUB_REPOSITORY"] = os.environ.get("GITHUB_REPOSITORY") or "NativeDog1/-Boot-Animation-Community-"
if not args.rehost:
    # 不给 token → 机器人跳过代管（它本来就会打印"没有 GH_TOKEN，跳过代管"）
    env.pop("GH_TOKEN", None)
    env.pop("GITHUB_TOKEN", None)
    print("（跳过代管：video 直接指向你给的直链）")

print("── 运行", SCRIPT.name, "──")
proc = subprocess.run([sys.executable, str(SCRIPT)], env=env, capture_output=True,
                      encoding="utf-8", errors="replace")
print((proc.stdout or "").strip()[-1500:])
if proc.returncode != 0:
    err = ROOT / ".github" / "last-error.txt"
    print("STDERR:", (proc.stderr or "").strip()[-400:])
    print("失败原因:", err.read_text(encoding="utf-8") if err.exists() else "(无)")
    sys.exit(proc.returncode)
print("✅ 机器人成功产出条目；下面自己 git add/commit/push 让网站更新")
