# 开机动画社区库（Boot Animation Community）

所有人可以在这里公开自己做的开机动画；软件用户可以在客户端里浏览、预览、自己挑一个装上。

> **设计原则：目录只存「元数据 + 视频链接 + 校验哈希」，视频由社区仓库自己的 Release 托管。**
> 所以我们不需要服务器、不承担费用（公开仓库的 Release 免费，单文件上限 2 GB）；
> 代价是做一次转存 —— 换来的是**投稿人不需要有仓库、不需要建 Release、也不需要长期有效的链接**，
> 以及链接不会因为作者删库或分享过期而失效。

## 客户端怎么用它

软件（`BootAnimation.exe`）在「浏览社区」里做这三件事：

1. 拉取本仓库生成的 `data/index.json`（目录索引）
2. 用户选中某条 → 从 `video` 字段的直链下载 → **用 `sha256` 校验完整性**（校验不通过就拒绝安装）
3. 通过后存到 `%LOCALAPPDATA%\BootAnimation\community\<id>.mp4`，之后就能像内置片段一样被选为开机动画

**只有用户主动选择并确认安装的视频才会被播放** —— 目录里的内容不会被自动装上。

## 一条目录条目长什么样

`data/animations/<owner>__<slug>.yml`，字段说明见 [SCHEMA.md](SCHEMA.md)，示例：

```yaml
id: nativedog1__cyber-neon
name: 赛博霓虹
author: NativeDog1
description: 蓝色数据流 + 霓虹脉冲，深色调，适合夜间开机
video: https://github.com/NativeDog1/boot-animations/releases/download/v1/cyber-neon-1440p.mp4
sha256: 填 64 位十六进制
bytes: 10485760
width: 2560
height: 1440
fps: 24
duration: 7.0
preview: https://raw.githubusercontent.com/NativeDog1/boot-animations/main/preview.jpg
license: CC-BY-4.0
tags: [赛博朋克, 深色, 蓝色]
nsfw: false
min_app: 1.1.0
submitted: 2026-09-29
```

## 怎么投稿（自助）

在 **Issues → 新建 → 「投稿开机动画」** 里按表单填好并提交。机器人会自动：

1. 检查必填字段、视频直链可达性、文件大小与格式
2. 校验通过 → **把视频搬进社区仓库的托管 Release `assets-v1`**（目录里的 `video` 从此指向社区自己的地址）→ 生成条目文件、刷新 `index.json`、合并进目录，并在 Issue 里回复「已上架」
3. 校验不通过 → 在 Issue 里列出缺哪一项，改好重新提交即可

**视频放哪**：推荐放在你自己仓库的 **Releases** 里（每文件最大 2 GB，免费）。
直链形如 `https://github.com/<你>/<仓库>/releases/download/<tag>/<文件>.mp4`。
也可以用任何稳定的 https 直链（对象存储、你自己的 CDN）。

**大文件（4K 原画等）怎么投**：GitHub 的 Issue 附件上限就是 25 MB，所以超过这个体积**没法直接拖进表单**。
**最省事的一条路**：用站点的投稿向导点「切成附件分片」—— 它把文件切成 20 MB 一块（流式哈希，多大的文件都不会卡），
自动生成分片信息并填进表单；你把那些分片**一起**拖进投稿表单就行，不需要仓库、Release 或网盘。
机器人按文件名顺序拼回、用 sha256 核对，顺序错了或漏片都会明确报出来。

**另一条路**：**你不需要有仓库，也不需要建 Release。** 把视频传到任何能直接下载的地方（自己的 Releases、
对象存储、网盘给的临时直链都行），把链接贴进表单的「视频」框 —— 机器人会自己去下载、算哈希、
量分辨率与时长，然后**把视频搬进社区仓库的托管 Release**（`assets-v1`，单文件上限 2 GB）。
所以你那个链接只需要在它下载的那几分钟里有效。
没有自己的仓库时，任何稳定的 https 直链都行，但**网盘分享页不行**：机器人要能直接下到文件本体。

> 建议 4K 原画之外**再单独投一版 1440p（约 10 MB）**：客户端会自动断点续传，但大文件终究要等，
> 而多数人只想要一个几秒钟就能装好的片头。

## 格式与画质建议

| 项目 | 建议 | 原因 |
|---|---|---|
| 分辨率 | **1440p（2560×1440）为主，4K 可选** | 社区库主流屏是 1440p；4K 单个几十 MB，下载体验会变差 |
| 时长 | 5–10 秒 | 开机动画超过 10 秒会让人烦 |
| 编码 | H.264 + AAC，**`-movflags +faststart`** | 不加 faststart 播放器要读完整个文件才出画面（表现为黑屏卡住） |
| 大小 | 建议 ≤ 30 MB（1440p） | 目录里会显示体积，用户会挑小的。**超过 25 MB 拖不进 Issue 表单**，贴个能直接下载的链接即可（机器人会替你托管）；硬上限 2 GB |
| 预览图 | 必填，一张 `preview` 链接 | 用户下载前要能看见长什么样 |
| 音频 | 可以带，但客户端默认可能静音 | 登录时突然出声对很多人是打扰 |
| 内容 | 不得含违法、色情、暴力、仇恨内容 | 见下方「内容与下架」 |

**做高画质的工具**：本地 4K 修复流程见技能 `jimeng-4k-video`（即梦原生 4K / 云端视频超分 / SeedVR2 本地放大三条路，含可量化的画质验收脚本）。

## 内容与下架

本目录采取**自助投稿 + 事后处置**，不做前置人工审核。所以：

- **每条都必须标 `nsfw`**（true/false）。客户端默认隐藏 `nsfw: true` 的条目，用户可在设置里打开
- 任何人对任何条目都可以提 **Issue（选「举报」模板）**：写明条目 id 与理由
- 维护者在核实后**直接下架**（删除条目文件 + 刷新索引），必要时封禁投稿者
- **投稿即表示你声明拥有该视频的权利或已获得授权**，并在条目里写明 `license`

## 网站（`docs/`，GitHub Pages 从这里发布）

网站是**预渲染的静态站**，没有服务器、没有框架、没有构建依赖：

```
data/index.json  ──┐
docs/content/docs.mjs ──┤
                   └─> node tools/build-site.mjs ──> docs/**（真页面）+ sitemap.xml + robots.txt + 搜索索引
```

为什么预渲染而不是纯客户端路由：每条动画要有一个**真文件**（`/animations/<id>/`），
这样刷新不会 404、每个页面有自己的 `<title>`/canonical/OG/JSON-LD（SEO 与分享卡片才成立）、
禁用 JS 也能把目录读完（JS 只做筛选、预览、深链这些增强）。

| 命令 | 作用 |
|---|---|
| `npm run build` | 读数据与文档内容，重新生成 `docs/` 下所有页面 |
| `npm run verify` | 自检：元信息是否齐全、有没有坏链、有没有伪造统计、有没有踩事实红线 |
| `npm run serve` | 本地预览（`http://127.0.0.1:8123`），复刻 Pages 的目录解析行为 |
| `npm test` | 目录纯逻辑的单元测试（27 个用例，零依赖，用 `node:test`） |
| `npm run check` | build + verify + test —— **投稿机器人上跑的就是这个**，不通过就不上架 |
| `node tools/browser-check.mjs <url>` | 真浏览器检查（Edge + DevTools 协议）：抓未捕获异常与 console 错误，还能 `--click` 点按钮。投稿向导就是用它验的 |
| `python tools/test-bot-resume.py <url>` | 对着「故意掐断连接」的服务器验证机器人下载会续传（需要 `node ../boot-animation-app/tools/serve-test.mjs` 起服务） |

**投稿上架时站点会自动重建**：机器人写完条目后会跑 `tools/build-site.mjs` + `tools/verify-site.mjs`，
把 `data/` 和 `docs/` 一起提交 —— 所以不会出现"目录里有、页面没有"的分裂状态；
校验不通过就不上架。

网站从不直接 fetch GitHub 的 URL：所有取数都经过 `docs/assets/js/repository.js` 里的
`AnimationRepository` 接口（当前实现是读仓库里的 JSON；将来要接 Cloudflare Workers / Supabase
之类，换一个实现类即可，页面代码一行都不用改）。

> 想要干净 URL 又不想依赖服务端渲染，这是 GitHub Pages 上的正解：**把页面在 CI 里生成出来**，
> 而不是让浏览器在运行时拼。代价是页面数随动画条数增长 —— 对几千条以内完全没问题。

## 目录索引

`data/index.json` 由机器人从 `data/animations/*.yml` 生成，**不要手改**。
客户端只读它，因此条目格式的任何变更都要保证向后兼容（新字段可选）。
