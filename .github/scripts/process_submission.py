#!/usr/bin/env python3
"""
处理一条投稿 Issue：校验 → 生成条目文件 → 刷新 index.json

由 .github/workflows/validate-submission.yml 调用。
Issue 由 .github/ISSUE_TEMPLATE/submit-animation.yml 表单生成，正文形如：

    ### 显示名

    赛博霓虹

    ### 视频 https 直链

    https://...

失败时把原因写进 .github/last-error.txt 并以非 0 退出，工作流会把它回帖给作者。
"""
import hashlib
import json
import os
import re
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ANIM_DIR = ROOT / "data" / "animations"
INDEX = ROOT / "data" / "index.json"
ERROR_FILE = ROOT / ".github" / "last-error.txt"

HEX64 = re.compile(r"^[0-9a-f]{64}$")
SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{1,40}$")
RES = re.compile(r"^(\d{2,5})\s*[x×]\s*(\d{2,5})$")

# 表单标题 → 内部字段名
FIELDS = {
    "显示名": "name",
    "英文标识": "slug",
    "视频 https 直链": "video",
    "视频 sha256": "sha256",
    "文件字节数": "bytes",
    "分辨率": "resolution",
    "时长（秒）": "duration",
    "预览图 https 直链": "preview",
    "授权方式": "license",
    "是否含不适宜内容": "nsfw",
    "标签": "tags",
    "一句话描述": "description",
    "声明": "declare",
}


def parse_body(body: str) -> dict:
    """把 issue 表单正文按 ### 标题切成字段。"""
    out, cur = {}, None
    for line in (body or "").splitlines():
        m = re.match(r"^###\s+(.+?)\s*$", line)
        if m:
            cur = FIELDS.get(m.group(1).strip())
            if cur:
                out[cur] = []
            continue
        if cur:
            out[cur].append(line)
    return {k: "\n".join(v).strip() for k, v in out.items()}


def fail(msg: str):
    ERROR_FILE.parent.mkdir(parents=True, exist_ok=True)
    ERROR_FILE.write_text(msg, encoding="utf-8")
    print("VALIDATION-FAILED:", msg)
    sys.exit(1)


def head_ok(url: str, want_prefix=("video/", "application/octet-stream")):
    """只做 HEAD，确认直链可达、不是网页。"""
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "boot-anim-bot"})
    with urllib.request.urlopen(req, timeout=30) as r:
        if r.status != 200:
            return False, f"HTTP {r.status}"
        ctype = (r.headers.get("content-type") or "").lower()
        length = r.headers.get("content-length")
        if ctype.startswith("text/html"):
            return False, f"这个链接返回的是网页（{ctype}），需要文件直链"
        return True, (ctype, length)


def main():
    body = os.environ.get("ISSUE_BODY", "")
    author = os.environ.get("ISSUE_USER", "unknown")
    f = parse_body(body)

    missing = [k for k in ("name", "slug", "video", "sha256", "bytes", "resolution", "duration", "preview", "license", "nsfw") if not f.get(k)]
    if missing:
        fail("缺少必填项：" + "、".join(missing) + "。请按 Issue 表单把每一项都填上。")

    if "我确认我拥有该视频的权利" not in f.get("declare", ""):
        fail("必须勾选「我确认我拥有该视频的权利或已获得授权」这一项。")

    if not SLUG.match(f["slug"]):
        fail(f"英文标识「{f['slug']}」不合法：只能用小写字母、数字、连字符或下划线，2–41 位。")

    if not HEX64.match(f["sha256"].strip().lower()):
        fail("sha256 必须是 64 位小写十六进制。可用 `certutil -hashfile 文件.mp4 SHA256` 获取。")

    try:
        size = int(str(f["bytes"]).replace(",", "").strip())
    except ValueError:
        fail("文件字节数必须是整数。Windows 上右键 → 属性 可以看到精确字节数。")

    if size <= 0 or size > 100 * 1024 * 1024:
        fail(f"文件大小 {size} 字节不合适：社区库建议 ≤ 100 MB（约 1440p 的 5–10 秒）。4K 版请作为可选项另发。")

    m = RES.match(f["resolution"].strip())
    if not m:
        fail("分辨率格式应为 2560x1440 这样。")
    width, height = int(m.group(1)), int(m.group(2))

    try:
        duration = float(str(f["duration"]).strip())
    except ValueError:
        fail("时长必须是数字（秒）。")
    if duration <= 0 or duration > 30:
        fail(f"时长 {duration} 秒不合适：开机动画建议 5–10 秒，最长不超过 30 秒。")

    for key in ("video", "preview"):
        url = f[key].strip()
        if not url.startswith("https://"):
            fail(f"{key} 必须是 https 直链。")
        try:
            ok, info = head_ok(url)
        except Exception as e:
            fail(f"{key} 无法访问：{e}")
        if not ok:
            fail(f"{key} 不可用：{info}")
        if key == "video" and info[1] and int(info[1]) != size:
            fail(f"声明的字节数 {size} 与直链实际大小 {info[1]} 不一致，请改正。")

    nsfw_raw = f["nsfw"].strip()
    nsfw = nsfw_raw in ("是", "true", "True", "yes")
    entry_id = f"{author.lower()}__{f['slug']}"
    tags = [t.strip() for t in re.split(r"[,，]", f.get("tags", "")) if t.strip()]

    entry = {
        "id": entry_id,
        "name": f["name"][:32],
        "author": author,
        "video": f["video"].strip(),
        "sha256": f["sha256"].strip().lower(),
        "bytes": size,
        "width": width,
        "height": height,
        "fps": 24,
        "duration": round(duration, 2),
        "preview": f["preview"].strip(),
        "license": f["license"].strip(),
        "nsfw": nsfw,
        "submitted": date.today().isoformat(),
    }
    if tags:
        entry["tags"] = tags
    if f.get("description"):
        entry["description"] = f["description"].strip()[:60]

    ANIM_DIR.mkdir(parents=True, exist_ok=True)
    target = ANIM_DIR / f"{entry_id}.yml"
    lines = [f"# 由投稿机器人生成，来自 Issue（作者 {author}）"]
    for k, v in entry.items():
        if isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        elif isinstance(v, list):
            lines.append(f"{k}:")
            lines.extend(f"  - {i}" for i in v)
        elif k in ("submitted", "sha256"):
            # 必须加引号：
            #   submitted —— 不加会被 YAML 解析成 date 对象，json.dumps 直接抛 TypeError
            #   sha256    —— 不加的话，纯数字的哈希（例如 0000…0000）会被解析成整数 0，
            #                客户端的哈希校验就永远失败。这个坑踩过，而且它不报错、只静默失效。
            lines.append(f"{k}: '{v}'")
        else:
            lines.append(f"{k}: {v}")
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # 刷新索引
    import yaml  # 在工作流里 pip install pyyaml

    entries, problems = [], []
    for p in sorted(ANIM_DIR.glob("*.yml")):
        with p.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        eid = data.get("id")
        if not eid:
            problems.append(f"{p.name}: 缺少 id")
            continue
        # sha256 必须是 64 位小写十六进制**字符串**。YAML 会把 0000…0000 这类纯数字哈希
        # 解析成整数，校验就会永远失败 —— 所以这里显式拦下并报错，不让它悄悄进索引。
        h = data.get("sha256")
        if not isinstance(h, str) or not HEX64.match(h.strip().lower()):
            problems.append(
                f"{eid}: sha256 不是 64 位小写十六进制字符串（YAML 里必须加引号，否则纯数字哈希会被解析成整数）"
            )
            continue
        data["sha256"] = h.strip().lower()
        for req in ("name", "video", "bytes", "preview"):
            if not data.get(req):
                problems.append(f"{eid}: 缺少 {req}")
        entries.append(data)
    if problems:
        fail("目录里有条目不合法，已阻止生成索引：\n" + "\n".join("  - " + x for x in problems))
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    # default=str 是第二道保险：万一某条存量 YAML 里的日期没加引号，也不会让整个索引生成失败
    INDEX.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8"
    )

    print(f"PUBLISHED: {entry_id}  （共 {len(entries)} 条）")
    # 用绝对路径：相对路径在非仓库根目录下运行时会崩（踩过）
    (ROOT / ".github" / "published.txt").write_text(
        f"已上架 `{entry_id}`（{entry['name']}），当前目录共 {len(entries)} 条。", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
