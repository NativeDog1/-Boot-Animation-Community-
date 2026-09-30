# 待启用的工作流（把这个文件移进 `.github/workflows/` 即可生效）

## 为什么它躺在这里

推送 `.github/workflows/` 下的文件需要 OAuth token 带 `workflow` 权限，而本机的 token 没有，
`gh auth refresh -s workflow` 又因为设备码端点连不上（网络层超时）走不通。
所以先把文件放在这个**不需要该权限的普通路径**，由你在网页上移一次即可 —— 网页操作走你自己的
登录会话，不受这个限制。

## 怎么启用（网页上三次点击）

1. 打开
   <https://github.com/NativeDog1/-Boot-Animation-Community-/blob/main/.github/pending/validate-submission.yml>
2. 点右上角铅笔图标（Edit）
3. 把顶部文件名输入框里的 `validate-submission.yml` 改成完整路径：
   `.github/workflows/validate-submission.yml`
   （GitHub 会把它**移动**过去 —— 输入带 `/` 的路径就是在移动文件）
4. 点 **Commit changes**

之后 `.github/workflows/validate-submission.yml` 就是真的工作流了，可以把这个
`.github/pending/` 目录删掉（网页上：进入该目录 → 右上角 … → Delete directory）。

## 它做什么

投稿 Issue 一提交就：

1. 校验必填项、直链可达性、体积与时长上限；
2. **把投稿文件搬进本仓库的托管 Release `assets-v1`**（目录里的 `video` 从此指向社区自己的地址）；
3. 生成条目文件、刷新 `data/index.json`；
4. **重建网站并跑自检与单测**（`tools/build-site.mjs` + `verify-site.mjs` + 43 项单测），
   把 `data/` 与 `docs/` 放在同一次提交里 —— 自检不过就**不上架**，避免"目录里有、页面上没有"；
5. 在 Issue 里回复「已上架」并关闭；校验不通过则列出缺哪一项，直接编辑该 Issue 即自动重试。

需要 `contents: write`（文件里已声明）；上传托管资产用的是 Actions 自带的 `GH_TOKEN`。
