#!/usr/bin/env python3
"""
处理一条投稿 Issue：校验 → 生成条目文件 → 刷新 index.json

设计原则（改过一版）：
    **凡是机器能算的，都不让用户填。**
用户只要把视频拖进表单（或贴一个 https 直链），其余 —— sha256、字节数、
分辨率、时长、名称、标识 —— 全部由这里自己下载、自己算。

为什么之前让用户填 sha256：那是个偷懒的设计，把校验成本转嫁给了投稿者。
现在由机器人下载后自己算，顺带还能验出「链接指向的到底是不是视频」。

由 .github/workflows/validate-submission.yml 调用。
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ANIM_DIR = ROOT / "data" / "animations"
INDEX = ROOT / "data" / "index.json"
ERROR_FILE = ROOT / ".github" / "last-error.txt"
OK_FILE = ROOT / ".github" / "published.txt"

SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{1,40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
RES = re.compile(r"^(\d{2,5})\s*[x×]\s*(\d{2,5})$")
VIDEO_EXT = re.compile(r"\.(mp4|mov|m4v|webm)(\?|$)", re.I)

# 单个文件上限：对齐 GitHub Release 附件的每文件上限（2 GB）—— 大文件唯一免费的
# 托管路径就是 Releases，硬上限不该比它更低。真正的门槛在提交者那边：Issue 附件只有
# 25 MB，超过就必须走 Releases 直链（见 .github/ISSUE_TEMPLATE/submit-animation.yml）。
MAX_BYTES = 2000 * 1024 * 1024
# 超过这个体积只是提醒，不算失败：4K 原画本来就这么大。
WARN_BYTES = 200 * 1024 * 1024
MAX_DURATION = 30.0
# 1 MB 一块；单次读超时 5 分钟（大文件在慢链路上很容易超过原来那 2 分钟）；
# 断线最多续传 4 轮 —— 断一次就整条投稿失败，对大文件是不可接受的。
CHUNK = 1 << 20
READ_TIMEOUT = 300
MAX_ATTEMPTS = 4
# 「分片投稿」清单前缀。格式与 docs/assets/js/lib/split.js 严格一致，
# 契约样本在 tools/fixtures/parts-manifest.txt，两端各有测试盯着它。
PARTS_PREFIX = "ba-parts:v1"
# 代管用的两个端点：建 release 走 api.github.com，传资产走 uploads.github.com
GITHUB_API = "https://api.github.com"
GITHUB_UPLOAD = "https://uploads.github.com"

# 表单标题 → 内部字段名（表单里只保留这几项，其余靠推导）
FIELDS = {
    "视频": "video",
    "视频文件或直链": "video",
    "分片信息": "parts",
    "名称": "name",
    "标签": "tags",
    "授权方式": "license",
    "是否含不适宜内容": "nsfw",
    "声明": "declare",
}


def parse_body(body: str) -> dict:
    """把 issue 表单正文按 ### 标题切成字段。

    注意：可选项留空时，GitHub 会填字面量 `_No response_`。不清理的话它会被当成
    真的标签/名称收进目录（实测踩到过）。"""
    out, cur = {}, None
    for line in (body or "").splitlines():
        m = re.match(r"^###\s+(.+?)\s*$", line)
        if m:
            cur = FIELDS.get(m.group(1).strip())
            if cur:
                out.setdefault(cur, [])
            continue
        if cur:
            out[cur].append(line)
    cleaned = {}
    for k, v in out.items():
        text = "\n".join(v).strip()
        cleaned[k] = "" if text.lower() == "_no response_" else text
    return cleaned


def fail(msg: str):
    ERROR_FILE.parent.mkdir(parents=True, exist_ok=True)
    ERROR_FILE.write_text(msg, encoding="utf-8")
    print("VALIDATION-FAILED:", msg)
    sys.exit(1)


def extract_video_url(text: str):
    """从字段里取出视频地址。
    用户可能是：拖进一个文件（GitHub 会插一段 markdown 或裸链接）、或直接贴直链。"""
    if not text:
        return None
    # markdown 图片/链接语法里的地址
    for m in re.finditer(r"\((https?://[^\s)]+)\)", text):
        if VIDEO_EXT.search(m.group(1)):
            return m.group(1)
    for m in re.finditer(r"https?://[^\s<>)\]]+", text):
        # 注意：这个正则没有捕获组，所以是 group(0) 而不是 group(1)（这里踩过 IndexError）
        if VIDEO_EXT.search(m.group(0)):
            return m.group(0)
    # 没带扩展名也接受（有些托管地址没有后缀，例如 GitHub 附件），取第一个 https 链接
    m = re.search(r"https?://[^\s<>)\]]+", text)
    return m.group(0) if m else None


def extract_video_urls(text):
    """取出字段里**所有**视频地址，按出现顺序。

    单文件投稿只有一个；分片投稿有 N 个（每片一个附件链接）。顺序取正文里的出现顺序 ——
    那是 GitHub 按拖入顺序插入的，而分片名零填充过（part01、part02…），
    所以拖入顺序 = 字母序 = 正确顺序。最终正确性由 sha256 判定。
    """
    if not text:
        return []
    urls = []
    for m in re.finditer(r"\((https?://[^\s)]+)\)", text):
        urls.append(m.group(1))
    if not urls:
        for m in re.finditer(r"https?://[^\s<>)\]]+", text):
            urls.append(m.group(0))
    seen, out = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def parse_parts_manifest(text):
    """解析投稿向导生成的「分片信息」。字段与 split.js 的 manifestOf 严格一致。"""
    raw = re.sub(r"\s+", "", str(text or ""))
    if not raw.startswith(PARTS_PREFIX):
        return None
    fields = {}
    for pair in raw[len(PARTS_PREFIX):].lstrip(";").split(";"):
        eq = pair.find("=")
        if eq > 0:
            fields[pair[:eq]] = pair[eq + 1:]
    try:
        total = int(fields.get("bytes", ""))
        count = int(fields.get("parts", ""))
        partbytes = int(fields.get("partbytes", "0") or 0)
    except (TypeError, ValueError):
        return None
    sha = (fields.get("sha256") or "").lower()
    if total <= 0 or count <= 0 or not HEX64.match(sha):
        return None
    return {"name": fields.get("name") or "video.mp4", "bytes": total,
            "parts": count, "partbytes": partbytes, "sha256": sha}


def download_with_resume(url, path, hasher=None, expected_bytes=None, label="文件"):
    """下到 path，支持 HTTP Range 续传与退避重试；返回收到的字节数。

    单文件投稿与分片投稿共用它 —— 这样"断流能不能接着下"只有一处实现、一处测试。
    """
    total = 0
    expected = expected_bytes

    for attempt in range(1, MAX_ATTEMPTS + 1):
        headers = {"User-Agent": "boot-anim-bot"}
        if total > 0:
            headers["Range"] = "bytes=%d-" % total
        read_to_end = False
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=READ_TIMEOUT) as r:
                ctype = (r.headers.get("content-type") or "").lower()
                if ctype.startswith("text/html"):
                    fail("这个链接返回的是网页而不是文件（%s）。请确认它是直链，"
                         "或者直接把视频文件拖进表单。" % ctype)

                status = getattr(r, "status", 200)
                if total > 0 and status != 206:
                    # 服务器不支持 Range（返回 200 全量）：只能从头来，别把两段拼一起
                    print("%s：服务器不支持续传（HTTP %s），从头下载" % (label, status), flush=True)
                    total = 0
                    if hasher is not None:
                        hasher = hashlib.sha256()

                if expected is None:
                    try:
                        cl = r.headers.get("content-length")
                        expected = (total + int(cl)) if cl else None
                    except (TypeError, ValueError):
                        expected = None

                with path.open("ab" if total > 0 else "wb") as f:
                    while True:
                        chunk = r.read(CHUNK)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_BYTES:
                            fail("文件超过 %d MB（已读 %d MB 就超了）。这是 GitHub Release "
                                 "的单文件上限，也是免费方案能支撑的极限 —— 请压缩，"
                                 "或同时提供一版 1440p。"
                                 % (MAX_BYTES // 1024 // 1024, total // 1024 // 1024))
                        if hasher is not None:
                            hasher.update(chunk)
                        f.write(chunk)
                read_to_end = True
        except SystemExit:
            raise
        except Exception as e:
            print("%s：第 %d 轮下载中断：%s" % (label, attempt, e), flush=True)

        if expected is not None and total >= expected:
            break
        # ⚠️ 必须区分「读到底了」和「这一轮抛异常了」：
        # 曾经写成 `if expected is None: break`，结果首轮握手失败（SSL EOF）也会跳出循环，
        # 文件压根没创建就去 stat，直接 FileNotFoundError；而且单文件路径下更糟 ——
        # 断在半路会被当成"下载完成"，算出来的 sha256 描述的是残缺数据，
        # 客户端下载完整文件后永远校验失败。
        if expected is None and read_to_end:
            break   # 服务器没给长度，但这一轮确实读到了 EOF
        if attempt < MAX_ATTEMPTS:
            time.sleep(2 * attempt)

    if total == 0:
        fail("%s：一个字节都没收到（多半是网络问题）。请重试；如果是直链，"
             "换一个稳定的托管位置再投。" % label)
    if expected is None:
        print("%s：服务器没给 Content-Length，无法校验完整性（已读到底）。" % label, flush=True)
    if expected is not None and total != expected:
        fail("%s 下载不完整：服务器声明 %d 字节（约 %.1f MB），续传 %d 轮后只收到 %d 字节（约 %.1f MB）。"
             "这个直链本身不稳定 —— 建议改用 Releases 托管，或者用投稿向导把文件切成附件分片。"
             % (label, expected, expected / 1048576, MAX_ATTEMPTS, total, total / 1048576))
    return total


def ffprobe_meta(path):
    """读分辨率与时长。读不出来不致命（交给上层"读不出就警告"的分支）。"""
    width = height = 0
    duration = 0.0
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-show_entries", "format=duration",
             "-of", "json", str(path)],
            capture_output=True, text=True, timeout=60,
        )
        if out.returncode == 0:
            j = json.loads(out.stdout or "{}")
            st = (j.get("streams") or [{}])[0]
            width = int(st.get("width") or 0)
            height = int(st.get("height") or 0)
            try:
                duration = float((j.get("format") or {}).get("duration") or 0)
            except (TypeError, ValueError):
                duration = 0.0
    except FileNotFoundError:
        fail("工作流里缺 ffprobe（应当在 validate-submission.yml 里装了 ffmpeg）")
    except Exception:
        pass
    return {"width": width, "height": height, "duration": duration}


def reassemble_parts(part_urls, manifest):
    """把 N 个分片按顺序拼回一个文件，并按清单校验大小与 sha256。

    sha256 是唯一可靠的裁判：顺序不对、少拖一片、多拖一份，哈希都会不符，
    这里就会明确报出来（而不是发布一条坏条目）。
    """
    if len(part_urls) != manifest["parts"]:
        fail("分片信息里写的是 %d 个分片，但表单里只找到 %d 个附件。请把 part01…part%02d **全部**一起拖进来。"
             % (manifest["parts"], len(part_urls), manifest["parts"]))

    work = Path(tempfile.mkdtemp())
    out_path = work / "submission.mp4"
    total = 0
    h = hashlib.sha256()
    n = len(part_urls)

    with out_path.open("wb") as out:
        for i, url in enumerate(part_urls, 1):
            part = work / ("part%03d" % i)
            # 除了最后一片，每片都应当是固定大小 —— 传错或多传，这里就能提前发现
            want = manifest["partbytes"] if (i < n and manifest["partbytes"] > 0) else None
            # 不把期望字节数交给下载器：那样大小不符会被报成"下载不完整、直链不稳定"，
            # 而真实原因通常是**拖入顺序不对**（把最后一片排到了第一个）。
            download_with_resume(url, part, None, None, "第 %d/%d 个分片" % (i, n))
            got_size = part.stat().st_size
            if want is not None and got_size != want:
                fail("第 %d/%d 个分片是 %d 字节，但按分片信息应当是 %d 字节。最常见的原因是**拖入顺序不对** —— 请按文件名 part01、part02… 的顺序全选后一起拖进来；也可能是漏拖或多拖了分片。"
                     % (i, n, got_size, want))
            with part.open("rb") as fh:
                while True:
                    block = fh.read(CHUNK)
                    if not block:
                        break
                    out.write(block)
                    h.update(block)
                    total += len(block)
            try:
                part.unlink()
            except OSError:
                pass

    if total != manifest["bytes"]:
        fail("分片拼起来是 %d 字节，但分片信息里写的是 %d 字节 —— 多半是少拖了某个分片，或者多拖了一份。请对照文件名 part01…part%02d 检查一遍。"
             % (total, manifest["bytes"], manifest["parts"]))
    actual = h.hexdigest()
    if actual != manifest["sha256"]:
        fail("分片内容对不上：拼起来算出的 sha256 与分片信息里的不一致。"
             "最常见的原因是分片顺序乱了 —— 请按文件名顺序（part01、part02…）重新选中、一起拖进表单。"
             + "\n\n算出来：%s\n清单里：%s" % (actual, manifest["sha256"]))

    info = {"sha256": actual, "bytes": total, "filename": manifest["name"], "path": str(out_path)}
    info.update(ffprobe_meta(out_path))
    print("REASSEMBLED: %d 个分片 → %d 字节，sha256=%s" % (n, total, actual[:16]), flush=True)
    return info


def probe_video(url: str):
    """下载视频并量出它的一切。机器能算的，绝不问用户。
    返回 dict(sha256, bytes, width, height, duration, filename)。"""
    tmp = Path(tempfile.mkdtemp()) / "submission.mp4"
    h = hashlib.sha256()
    total = download_with_resume(url, tmp, h, None, "视频")
    if total < 100 * 1024:
        fail(f"下载到的文件只有 {total} 字节，明显不是视频。")

    width = height = 0
    duration = 0.0
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=width,height", "-show_entries", "format=duration",
             "-of", "json", str(tmp)],
            capture_output=True, text=True, timeout=60,
        )
        if out.returncode == 0:
            j = json.loads(out.stdout or "{}")
            st = (j.get("streams") or [{}])[0]
            width = int(st.get("width") or 0)
            height = int(st.get("height") or 0)
            try:
                duration = float((j.get("format") or {}).get("duration") or 0)
            except (TypeError, ValueError):
                duration = 0.0
    except FileNotFoundError:
        fail("工作流里缺 ffprobe（应当在 validate-submission.yml 里装了 ffmpeg）")
    except Exception:
        pass  # 读不出分辨率不致命，交给下面「读不出就警告」的分支

    return {
        "sha256": h.hexdigest(),
        "bytes": total,
        "width": width,
        "height": height,
        "duration": duration,
        "filename": Path(url.split("?")[0]).name or "animation.mp4",
        "path": str(tmp),   # 留给截预览帧用
    }


def derive_name(raw: str, filename: str) -> str:
    """名称：用户填了就用，没填就从文件名推。"""
    if raw:
        return raw.strip()[:32]
    stem = Path(filename).stem
    stem = re.sub(r"^[0-9a-f]{8,}[-_]", "", stem)          # 去掉哈希前缀
    stem = re.sub(r"[-_]+", " ", stem).strip()
    return (stem or "社区片头")[:32]


def derive_slug(raw: str, author: str, sha256: str) -> str:
    """标识：用户填了就用；没填就用作者 + 哈希前 8 位，保证唯一且合法。"""
    s = (raw or "").strip().lower()
    if s and SLUG.match(s):
        return s
    if s:
        s = re.sub(r"[^a-z0-9_-]+", "-", s).strip("-")
        if SLUG.match(s):
            return s
    return re.sub(r"[^a-z0-9_-]+", "-", author.lower())[:20].strip("-") + "-" + sha256[:8]


PREVIEW_DIR = ROOT / "data" / "previews"
RAW_PREVIEW = ("https://raw.githubusercontent.com/"
               "NativeDog1/-Boot-Animation-Community-/main/data/previews/")


def frame_brightness(jpg: Path) -> float:
    """把图缩成 1x1 灰度，那一个字节就是平均亮度。
    比 PIL 省事，也不需要额外依赖（CI 里只装了 ffmpeg）。"""
    try:
        out = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", str(jpg), "-vf", "scale=1:1",
             "-f", "rawvideo", "-pix_fmt", "gray", "-"],
            capture_output=True, timeout=30,
        )
        return float(out.stdout[0]) if out.stdout else -1.0
    except Exception:
        return -1.0


def extract_preview(video: Path, entry_id: str, duration: float):
    """从视频里截一帧当预览图 —— 投稿者不需要上传预览图。

    为什么多截几帧再挑：开机动画的开头常常是淡入的黑场、结尾常是完成态，
    写死某一帧容易截到全黑。所以截 4 个时间点，挑平均亮度最高的那张
    （同一亮度时取靠后的，因为完成态通常更好看）。
    """
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    times = [1.0,
             max(0.1, duration * 0.5) if duration else 1.5,
             max(0.1, duration * 0.9) if duration else 2.0,
             max(0.1, duration - 0.15) if duration else 2.5]

    best_score, best_path = -1.0, None
    for i, ts in enumerate(times):
        tmp = PREVIEW_DIR / (".tmp-%s-%d.jpg" % (entry_id, i))
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-ss", "%.2f" % ts, "-i", str(video),
                 "-frames:v", "1", "-vf", "scale=1280:-2", "-q:v", "3", str(tmp)],
                capture_output=True, timeout=60,
            )
        except Exception:
            continue
        if not tmp.exists() or tmp.stat().st_size == 0:
            continue
        score = frame_brightness(tmp)
        if score > best_score:
            if best_path is not None:
                try: best_path.unlink()
                except Exception: pass
            best_score, best_path = score, tmp
        else:
            try: tmp.unlink()
            except Exception: pass

    if best_path is None:
        return None
    target = PREVIEW_DIR / (entry_id + ".jpg")
    best_path.replace(target)
    print(f"PREVIEW: 截了第 {best_score:.0f}/255 亮度的帧 → {target.name}")
    return target


def check_url_scheme(url: str):
    if not url.startswith("https://"):
        fail("链接必须是 https。把视频拖进表单比手填链接更省事。")


def api_request(req, timeout=120):
    """带 token 调 GitHub API。"""
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    req.add_header("Authorization", "Bearer " + token)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "boot-anim-bot")
    return urllib.request.urlopen(req, timeout=timeout)


# 托管位置：仓库里**既有**的那个 Release（用户 2026-09-29 建的 `assets-v1`，标题「社区视频资源」）
# 用它而不是每条投稿建一个 release —— 一处集中、页面可浏览、下架只需删一个资产。
HOSTING_TAG = os.environ.get("HOSTING_TAG") or "assets-v1"


def asset_name(entry_id, info):
    """资产名用纯 ASCII：URL 里不要出现百分号编码（这是那个 release 说明里定的约定）。"""
    ext = ".mp4"
    m = re.search(r"\.(mp4|mov|m4v|webm)$", Path(info["filename"]).name, re.I)
    if m:
        ext = "." + m.group(1).lower()
    return entry_id + ext


def rehost(entry_id, display_name, author, info, source_url):
    """把投稿文件搬进社区仓库的托管 Release（默认 `assets-v1`），返回长期直链；失败返回 None。

    为什么要有这一步：对没有代码经验的人来说，「建仓库 → 建 Release → 传文件 → 复制直链」
    本身就是一道过不去的墙。所以投稿人只需要把文件给出来（拖进表单的附件，或者一个
    临时直链），托管由机器人接手：
      · Release 单文件上限 2 GB，公开仓库免费；
      · 目录里的 video 从此是社区自己的地址，不会因为作者删库或分享过期而失效；
      · 下架 = 删掉这个资产 + 条目文件。
    失败时**不阻断上架**：退回用投稿人给的链接，并在 Issue 回复里说清。
    """
    repo = os.environ.get("GITHUB_REPOSITORY", "")
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    if not repo or not token:
        print("没有 GITHUB_REPOSITORY / GH_TOKEN，跳过代管（video 仍指向原链接）", flush=True)
        return None

    name = asset_name(entry_id, info)
    label = (display_name or entry_id) + " · " + (author or "匿名")

    try:
        # 1) 找托管 release；没有就按同样的约定建一个
        release = None
        try:
            with api_request(urllib.request.Request(
                    GITHUB_API + "/repos/" + repo + "/releases/tags/" + HOSTING_TAG)) as r:
                release = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
        if release is None:
            payload = json.dumps({
                "tag_name": HOSTING_TAG,
                "name": "社区视频资源",
                "body": "投稿视频的托管位置：客户端从这里下载，并用 sha256 校验完整性。",
            }).encode("utf-8")
            req = urllib.request.Request(GITHUB_API + "/repos/" + repo + "/releases",
                                         data=payload, method="POST")
            req.add_header("Content-Type", "application/json")
            with api_request(req) as r:
                release = json.loads(r.read().decode("utf-8"))

        release_id = release["id"]

        # 2) 同名资产先删掉（重复投稿 / 更正后重投）
        for a in release.get("assets") or []:
            if a.get("name") == name:
                api_request(urllib.request.Request(
                    GITHUB_API + "/repos/" + repo + "/releases/assets/" + str(a["id"]), method="DELETE"))
                print("已删除同名旧资产：" + name, flush=True)

        # 3) 传资产。用文件对象流式上传（显式给 Content-Length），
        #    不要把 2 GB 读进内存 —— 下载那边就是这么写的。
        query = "?name=" + urllib.parse.quote(name) + "&label=" + urllib.parse.quote(label)
        with open(info["path"], "rb") as fh:
            upload = urllib.request.Request(
                GITHUB_UPLOAD + "/repos/" + repo + "/releases/" + str(release_id) + "/assets" + query,
                data=fh, method="POST")
            upload.add_header("Content-Type", "video/mp4")
            upload.add_header("Content-Length", str(info["bytes"]))
            with api_request(upload, timeout=1800) as r:
                asset = json.loads(r.read().decode("utf-8"))

        url = asset.get("browser_download_url")
        print("HOSTED: " + str(url) + "（原链接 " + source_url + "）", flush=True)
        return url or None
    except Exception as e:
        print("代管失败（不影响上架，video 仍指向原链接）：" + str(e), flush=True)
        return None

def main():
    body = os.environ.get("ISSUE_BODY", "")
    author = os.environ.get("ISSUE_USER", "unknown")
    f = parse_body(body)

    if "我确认我拥有该视频的权利" not in f.get("declare", ""):
        fail("必须勾选「我确认我拥有该视频的权利或已获得授权」这一项。")

    urls = extract_video_urls(f.get("video", ""))
    if not urls:
        fail("没在「视频」这一栏里找到文件或链接。\n"
             "最省事的做法：**直接把视频文件拖进那个文本框**；\n"
             "大于 25 MB 就先用投稿向导把它切成附件分片，再把那些分片**一起**拖进去。")
    parts_manifest = parse_parts_manifest(f.get("parts", ""))

    # ── 机器自己算：下载、哈希、分辨率、时长
    if parts_manifest:
        # 分片投稿：附件顺序不值得信任，正确性完全由清单里的 sha256 判定
        for u in urls:
            check_url_scheme(u)
        info = reassemble_parts(urls, parts_manifest)
        url = urls[0] if len(urls) == 1 else "(分片投稿：%d 个附件)" % len(urls)
    else:
        url = urls[0]
        check_url_scheme(url)
        info = probe_video(url)
    print(f"PROBED: {info['bytes']} bytes, {info['width']}x{info['height']}, "
          f"{info['duration']:.2f}s, sha256={info['sha256'][:16]}…")

    if info["bytes"] <= 0:
        fail("下载到的文件是空的。")
    if info["duration"] > MAX_DURATION:
        fail(f"时长 {info['duration']:.1f} 秒超过上限 {MAX_DURATION:.0f} 秒。开机动画建议 5–10 秒。")
    if info["width"] and max(info["width"], info["height"]) > 3840:
        fail(f"分辨率 {info['width']}x{info['height']} 超过 4K，没必要。")

    nsfw_raw = f.get("nsfw", "").strip()
    nsfw = nsfw_raw in ("是", "true", "True", "yes")
    name = derive_name(f.get("name", ""), info["filename"])
    slug = derive_slug("", author, info["sha256"])
    entry_id = f"{author.lower()}__{slug}"
    tags = [t.strip() for t in re.split(r"[,，]", f.get("tags", "")) if t.strip()]

    # ── 代管：把文件搬进社区仓库自己的 Release ──
    # 投稿人不需要有仓库、不需要自己建 Release、也不需要长期稳定的链接。
    hosted_url = rehost(entry_id, name, author, info, url)
    video_url = hosted_url or url

    # 预览图由机器人从视频里截一帧，不让投稿者上传；截出来的图会随条目一起提交进仓库
    preview_url = ""
    shot = extract_preview(Path(info["path"]), entry_id, info["duration"])
    if shot is not None:
        preview_url = RAW_PREVIEW + entry_id + ".jpg"
    else:
        # 截帧失败（极少见）也不能把预览设成视频地址 —— <img> 拿到 mp4 只会显示加载失败
        preview_url = ""

    entry = {
        "id": entry_id,
        "name": name,
        "author": author,
        "video": video_url,
        "sha256": info["sha256"],
        "bytes": info["bytes"],
        "width": info["width"],
        "height": info["height"],
        "fps": 24,
        "duration": round(info["duration"], 2),
        "preview": preview_url,
        "license": f.get("license", "").strip() or "未声明",
        "nsfw": nsfw,
        "submitted": date.today().isoformat(),
    }
    if tags:
        entry["tags"] = tags
    if hosted_url:
        # 可选字段：记录原链接以便追溯（客户端不读它）
        entry["source"] = url
    if not preview_url:
        print("警告：没能截出预览图，客户端会显示占位而不是封面")

    ANIM_DIR.mkdir(parents=True, exist_ok=True)
    target = ANIM_DIR / f"{entry_id}.yml"
    lines = [f"# 由投稿机器人生成（作者 {author}）；元数据全部由机器人下载后自行计算"]
    for k, v in entry.items():
        if isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        elif isinstance(v, list):
            lines.append(f"{k}:")
            lines.extend(f"  - {i}" for i in v)
        elif k in ("submitted", "sha256"):
            # 必须加引号：submitted 不加会被解析成 date（JSON 序列化会炸）；
            # sha256 不加的话，纯数字哈希会被解析成整数（客户端校验会永远失败）。
            lines.append(f"{k}: '{v}'")
        else:
            lines.append(f"{k}: {v}")
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # ── 刷新索引（顺带守一道：任何条目不合法就阻止索引生成，不让它悄悄上线）
    import yaml

    entries, problems = [], []
    for p in sorted(ANIM_DIR.glob("*.yml")):
        data = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
        eid = data.get("id")
        if not eid:
            problems.append(f"{p.name}: 缺少 id")
            continue
        hs = data.get("sha256")
        if not isinstance(hs, str) or not HEX64.match(hs.strip().lower()):
            problems.append(f"{eid}: sha256 不是 64 位小写十六进制字符串")
            continue
        data["sha256"] = hs.strip().lower()
        for req in ("name", "video", "bytes", "preview"):
            if not data.get(req):
                problems.append(f"{eid}: 缺少 {req}")
        entries.append(data)
    if problems:
        fail("目录里有条目不合法，已阻止生成索引：\n" + "\n".join("  - " + x for x in problems))

    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(entries, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")

    print(f"PUBLISHED: {entry_id}  （共 {len(entries)} 条）")

    # 顺手让 jsDelivr 的缓存失效。它缓存分支引用最长 12 小时，不 purge 的话
    # 「网页用的是 jsDelivr」的用户会在半天内看不到刚上架的条目。
    # 尽力而为：purge 失败绝不影响上架。
    try:
        purge = ("https://purge.jsdelivr.net/gh/"
                 "NativeDog1/-Boot-Animation-Community-@main/data/index.json")
        urllib.request.urlopen(
            urllib.request.Request(purge, headers={"User-Agent": "boot-anim-bot"}),
            timeout=30,
        ).read()
        print("PURGED: jsDelivr 缓存已请求失效")
    except Exception as e:
        print(f"purge 失败（不影响上架）: {e}")
    # 用绝对路径：相对路径在非仓库根目录下运行时会崩（踩过）
    OK_FILE.parent.mkdir(parents=True, exist_ok=True)
    OK_FILE.write_text(
        f"已上架 `{entry_id}`（{name}），当前目录共 {len(entries)} 条。\n\n"
        f"| 项 | 值 |\n|---|---|\n"
        f"| 分辨率 | {info['width']}×{info['height']} |\n"
        f"| 时长 | {info['duration']:.1f} 秒 |\n"
        f"| 体积 | {info['bytes'] / 1048576:.1f} MB |\n"
        f"| sha256 | `{info['sha256']}` |\n\n"
        f"这些**都是机器人自己算的**，你不用填。\n\n"
        + (f"视频已由社区仓库**代为托管**（Release `{entry_id}`）—— 你不用管原来那个链接了。\n"
           if hosted_url else
           "视频仍指向你提供的链接：**请保持它长期有效**，否则条目会失效。\n"),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
