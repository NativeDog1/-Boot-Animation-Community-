"""端到端跑一次完整投稿流水线（就像 GitHub Actions 那样调用机器人）。

为什么要它：分片拼回、代管、写条目、刷索引这几段各自都测过，但**连起来**没跑过；
而且之前分片路径只用本地 http 验证过，生产是 https。

做法：
  1. 把真实视频切成 3 片；
  2. 传到一个**临时 release**（当"Issue 附件"用，这样链接是真实 https）；
  3. 拼出与投稿表单同构的 Issue 正文（含分片信息清单）；
  4. 用子进程跑 process_submission.py（与工作流完全一样的调用方式）；
  5. 断言：条目文件生成、index.json 收录、video 指向社区托管地址、sha256 与原件一致；
  6. **清理**：删临时 release、删代管产生的资产、删测试条目、还原 index.json。

    python tools/test-submit-e2e.py
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SCRIPT = ROOT / ".github" / "scripts" / "process_submission.py"
VIDEO = Path(os.environ["TEMP"]) / "ba-test" / "real.mp4"
REPO = os.environ.get("GITHUB_REPOSITORY") or "NativeDog1/-Boot-Animation-Community-"
TOKEN = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
TAG = "selftest-parts-%d" % int(time.time())
AUTHOR = "selftestbot"
fails = []
made = {"release": None, "assets": [], "entry": None}

if not TOKEN:
    print("缺少 GH_TOKEN")
    sys.exit(2)
if not VIDEO.exists():
    print("缺少测试视频", VIDEO)
    sys.exit(2)


def api(method, path, data=None, ctype="application/json"):
    req = urllib.request.Request("https://api.github.com" + path, data=data, method=method)
    req.add_header("Authorization", "Bearer " + TOKEN)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "boot-anim-bot")
    if data is not None:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            body = r.read().decode("utf-8")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        print("API 失败", method, path, e.code, e.read().decode("utf-8")[:200])
        return None


try:
    # ── 1. 切分片
    data = VIDEO.read_bytes()
    part_size = 1024 * 1024
    chunks = [data[i:i + part_size] for i in range(0, len(data), part_size)]
    work = Path(tempfile.mkdtemp())
    names = []
    for i, chunk in enumerate(chunks, 1):
        name = "p%02dof%02d.mp4" % (i, len(chunks))
        (work / name).write_bytes(chunk)
        names.append(name)
    sha = hashlib.sha256(data).hexdigest()
    print("切成 %d 片，原件 sha256=%s" % (len(chunks), sha[:16]))

    # ── 2. 传到临时 release（当附件用）
    rel = api("POST", "/repos/%s/releases" % REPO, json.dumps({
        "tag_name": TAG, "name": "E2E SELFTEST（跑完自动删）",
        "body": "自动化测试用的临时分片，跑完即删。",
    }).encode("utf-8"))
    if not rel:
        raise SystemExit("建临时 release 失败")
    made["release"] = rel["id"]
    print("临时 release:", rel["id"], "tag:", TAG)

    urls = []
    for name in names:
        blob = (work / name).read_bytes()
        q = "?name=" + urllib.parse.quote(name)
        req = urllib.request.Request(
            "https://uploads.github.com/repos/%s/releases/%d/assets%s" % (REPO, rel["id"], q),
            data=blob, method="POST")
        req.add_header("Authorization", "Bearer " + TOKEN)
        req.add_header("Content-Type", "video/mp4")
        req.add_header("User-Agent", "boot-anim-bot")
        with urllib.request.urlopen(req, timeout=300) as r:
            asset = json.loads(r.read().decode("utf-8"))
        urls.append(asset["browser_download_url"])
    print("已上传 %d 个分片" % len(urls))

    # ── 3. 拼 / 4. 跑机器人
    manifest = "ba-parts:v1;name=%s;bytes=%d;parts=%d;partbytes=%d;sha256=%s" % (
        "selftest-e2e.mp4", len(data), len(chunks), part_size, sha)
    body = "\n".join([
        "### 视频", "",
        "\n".join("[%s](%s)" % (n, u) for n, u in zip(names, urls)), "",
        "### 分片信息", "", manifest, "",
        "### 名称", "", "E2E 自测条目（跑完自动删）", "",
        "### 标签", "", "自测", "",
        "### 授权方式", "", "CC0-1.0", "",
        "### 是否含不适宜内容", "", "否", "",
        "### 声明", "",
        "- [X] 我确认我拥有该视频的权利或已获得授权，且内容不含违法、色情、暴力或仇恨内容",
        "- [X] 我理解本目录采取「自助投稿 + 事后下架」",
    ])
    env = dict(os.environ)
    env.update({"ISSUE_BODY": body, "ISSUE_USER": AUTHOR,
                "GH_TOKEN": TOKEN, "GITHUB_REPOSITORY": REPO})
    print("── 运行 process_submission.py ──")
    proc = subprocess.run([sys.executable, str(SCRIPT)], env=env, capture_output=True, encoding="utf-8", errors="replace")
    print((proc.stdout or "").strip()[-800:])
    if proc.returncode != 0:
        err = (ROOT / ".github" / "last-error.txt")
        print("STDERR:", (proc.stderr or "").strip()[-300:])
        print("校验失败原因:", err.read_text(encoding="utf-8")[:300] if err.exists() else "(无)")
        fails.append("机器人退出码 %d" % proc.returncode)

    # ── 5. 断言
    entry_id = None
    for p in sorted((ROOT / "data" / "animations").glob("%s__*.yml" % AUTHOR)):
        entry_id = p.stem
        made["entry"] = p
    if not entry_id:
        fails.append("没有生成条目文件")
    else:
        text = (ROOT / "data" / "animations" / (entry_id + ".yml")).read_text(encoding="utf-8")
        index = json.loads((ROOT / "data" / "index.json").read_text(encoding="utf-8"))
        hit = [e for e in index if e.get("id") == entry_id]
        print("条目:", entry_id)
        print(text.strip()[:400])
        if not hit:
            fails.append("index.json 里没有这条")
        else:
            if hit[0].get("sha256") != sha:
                fails.append("条目 sha256 与原件不一致")
            if hit[0].get("bytes") != len(data):
                fails.append("条目 bytes 不是拼回后的总长")
            if "releases/download/assets-v1/" not in str(hit[0].get("video", "")):
                fails.append("video 没有指向社区托管 Release：%s" % hit[0].get("video"))
            else:
                print("✅ video 指向社区托管：", hit[0]["video"])
            if "source" in hit[0]:
                print("✅ 记录了原链接（分片说明）：", str(hit[0]["source"])[:60])
finally:
    # ── 6. 清理
    print("── 清理 ──")
    for p in (ROOT / "data" / "animations").glob("%s__*.yml" % AUTHOR):
        made["entry"] = p
        try:
            made["entry"].unlink()
            print("删除测试条目", made["entry"].name)
        except OSError:
            pass
    # 还原 index.json 与 bot 产物
    subprocess.run(["git", "-C", str(ROOT), "checkout", "--", "data/index.json"], capture_output=True)
    for junk in (".github/published.txt", ".github/last-error.txt",
                 "data/previews/%s__*.jpg" % AUTHOR):
        for p in ROOT.glob(junk):
            try:
                p.unlink()
                print("删除", p.name)
            except OSError:
                pass
    # 删代管进 assets-v1 的资产
    rel_host = api("GET", "/repos/%s/releases/tags/assets-v1" % REPO)
    for a in (rel_host or {}).get("assets") or []:
        if a["name"].startswith(AUTHOR + "__"):
            api("DELETE", "/repos/%s/releases/assets/%d" % (REPO, a["id"]))
            print("删除代管资产", a["name"])
    # 删临时 release 与 tag
    if made["release"]:
        api("DELETE", "/repos/%s/releases/%d" % (REPO, made["release"]))
        print("删除临时 release", made["release"])
    api("DELETE", "/repos/%s/git/refs/tags/%s" % (REPO, urllib.parse.quote(TAG)))
    shutil.rmtree(work, ignore_errors=True)
    # 只关心"机器人留下的东西"：脚本自身、以及正在改的机器人源码不算残留
    ignore = ("tools/test-submit-e2e.py", ".github/scripts/process_submission.py")
    dirty = [line for line in subprocess.run(
        ["git", "-C", str(ROOT), "status", "--porcelain"],
        capture_output=True, text=True, encoding="utf-8", errors="replace").stdout.splitlines()
        if line.strip() and not any(x in line for x in ignore)]
    print("机器人残留改动:", dirty if dirty else "（无）")
    if dirty:
        fails.append("仓库没清干净:\n" + "\n".join(dirty)[:300])

print("RESULT:", "PASS 整条投稿流水线端到端跑通" if not fails else "FAIL " + "; ".join(fails))
sys.exit(0 if not fails else 1)
