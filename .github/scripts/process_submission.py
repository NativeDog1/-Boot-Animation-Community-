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

MAX_BYTES = 100 * 1024 * 1024
MAX_DURATION = 30.0

# 表单标题 → 内部字段名（表单里只保留这几项，其余靠推导）
FIELDS = {
    "视频": "video",
    "视频文件或直链": "video",
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


def probe_video(url: str):
    """下载视频并量出它的一切。机器能算的，绝不问用户。
    返回 dict(sha256, bytes, width, height, duration, filename)。"""
    tmp = Path(tempfile.mkdtemp()) / "submission.mp4"
    req = urllib.request.Request(url, headers={"User-Agent": "boot-anim-bot"})
    h = hashlib.sha256()
    total = 0
    expected = None
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            ctype = (r.headers.get("content-type") or "").lower()
            if ctype.startswith("text/html"):
                fail(f"这个链接返回的是网页而不是文件（{ctype}）。请确认它是视频直链，"
                     f"或者直接把视频文件拖进表单。")
            try:
                cl = r.headers.get("content-length")
                expected = int(cl) if cl else None
            except (TypeError, ValueError):
                expected = None
            with tmp.open("wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_BYTES:
                        fail(f"文件超过 {MAX_BYTES // 1024 // 1024} MB（已读 {total // 1024 // 1024} MB 就超了）。"
                             f"社区建议 1440p、30 MB 以内。")
                    h.update(chunk)
                    f.write(chunk)
    except SystemExit:
        raise
    except Exception as e:
        fail(f"下载不了这个地址：{e}")

    # ⚠️ 必须校验完整性：网络中断时 urlopen 会"正常结束"，读到的却是个残缺文件。
    # 不校验的话，算出来的 sha256 是**残缺数据的哈希** —— 客户端下载完整文件后
    # 校验永远失败，而我们已经在目录里发布了一条坏条目。（这个坑实测踩到过。）
    if expected is not None and total != expected:
        fail(f"下载不完整：服务器声明 {expected} 字节（约 {expected / 1048576:.1f} MB），"
             f"实际只收到 {total} 字节（约 {total / 1048576:.1f} MB）—— 网络中断了。"
             f"如果是 GitHub Releases 上的大文件在国内下载不稳定，"
             f"建议把视频压到 30 MB 以内（1440p）再投。")
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


def main():
    body = os.environ.get("ISSUE_BODY", "")
    author = os.environ.get("ISSUE_USER", "unknown")
    f = parse_body(body)

    if "我确认我拥有该视频的权利" not in f.get("declare", ""):
        fail("必须勾选「我确认我拥有该视频的权利或已获得授权」这一项。")

    url = extract_video_url(f.get("video", ""))
    if not url:
        fail("没在「视频」这一栏里找到文件或链接。\n"
             "最省事的做法：**直接把视频文件拖进那个文本框**，GitHub 会自己上传并填好链接；\n"
             "或者粘贴一个 https 直链（例如你自己仓库 Releases 里的地址）。")
    check_url_scheme(url)

    # ── 机器自己算：下载、哈希、分辨率、时长
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
        "video": url,
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
        f"这些**都是你自己算的**，你不用填。",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
