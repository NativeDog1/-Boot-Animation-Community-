# 条目字段说明（SCHEMA）

一个条目 = `data/animations/<owner>__<slug>.yml` 一个文件。
`index.json` 是它们的数组形式（机器人生成，客户端只读这个）。

## 必填

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 全局唯一，格式 `<owner>__<slug>`，只含小写字母、数字、`-`、`_`。必须与文件名一致 |
| `name` | string | 显示名，≤ 32 字 |
| `author` | string | 作者名（GitHub 用户名或昵称） |
| `video` | string | **https 直链**，指向 mp4。不要放网盘分享页，要直链 |
| `sha256` | string | 视频文件的 sha256（64 位小写十六进制）。客户端据此校验，**不匹配就拒绝安装** |
| `bytes` | number | 文件字节数 |
| `width` / `height` | number | 分辨率 |
| `duration` | number | 秒，可带小数 |
| `preview` | string | **https 直链**预览图（jpg/png），用户下载前看的就是它 |
| `license` | string | 例如 `CC-BY-4.0`、`CC0-1.0`、`自创，允许转载` |
| `nsfw` | boolean | 是否含不适宜内容。客户端默认隐藏 `true` |
| `submitted` | string | `YYYY-MM-DD` |

## 选填

| 字段 | 类型 | 说明 |
|---|---|---|
| `description` | string | 一句话描述，≤ 60 字 |
| `fps` | number | 默认 24 |
| `tags` | string[] | 用于筛选，例如 `[赛博朋克, 深色, 蓝色]` |
| `has_audio` | boolean | 是否有音轨 |
| `min_app` | string | 需要的最低客户端版本，例如 `1.1.0` |
| `source` | string | 投稿人给的原始链接（上架时机器人会把它搬进托管 Release，这个字段只用于追溯；客户端不读它） |

## 上限（机器人把关）

| 项 | 上限 | 说明 |
|---|---|---|
| 体积 | **2 GB** | 对齐 GitHub Release 的单文件上限 —— 那也是大文件唯一免费的托管路径 |
| 时长 | **30 秒** | 开机动画建议 5–10 秒 |
| 分辨率 | 4K（3840×2160） | 再高没必要，下载也慢 |

**提交方式按体积分两条路**：

- **≤ 25 MB** —— 直接把文件拖进投稿表单（GitHub 会托管它并自动填好直链）。
- **> 25 MB** —— 把视频传到任何能直接下载的地方，把链接贴进表单即可。
  Issue 附件上限就是 25 MB，拖进去会直接上传失败。

**两条路都不需要投稿人有仓库或 Release**：机器人校验通过后会把文件
**搬进本仓库的托管 Release（`assets-v1`）**，条目里的 `video` 从此指向社区自己的地址。
所以投稿人给的链接只需要在机器人下载的那几分钟里有效。原始链接记在可选的 `source` 字段里。

客户端下载支持**断点续传 + 自动重试**（HTTP Range），所以大文件在慢网络下也能装上。

## 三条硬规则

1. **`video` 与 `preview` 必须是 https 直链**：客户端直接下，不解析网页。网盘分享链接不合格。
2. **`sha256` 必须与文件一致**：这是唯一的安全校验手段。改了视频就必须改哈希。
3. **`nsfw` 必须显式填写**：漏填会导致条目校验失败，而不是被当成 `false`。

## 客户端如何使用

```
GET  data/index.json                     → 列出所有条目（含 name / author / preview / bytes / tags / nsfw）
用户选中某条
GET  <video>                             → 边下边显示进度
校验 sha256 与 bytes                      → 不符则删除并报错
保存 %LOCALAPPDATA%\BootAnimation\community\<id>.mp4
列出片头时与内置片段一起显示（来源标记为「社区」）
```
