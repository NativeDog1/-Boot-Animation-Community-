/**
 * docs.mjs — 文档内容模块（本站唯一的内容数据源）。
 *
 * 约束：无依赖、无副作用、无 import；只导出 DOC_GROUPS 与 DOCS。
 * 每个条目的 html 是 HTML 片段（不含 html/head/body），
 * 只使用设计系统允许的标签与 class。
 */

export const DOC_GROUPS = [
  { id: 'start',    label: '开始' },
  { id: 'use',      label: '使用' },
  { id: 'create',   label: '制作与投稿' },
  { id: 'support',  label: '排错与恢复' },
];

export const DOCS = [

  /* ───────────────────────────── 1. start ───────────────────────────── */
  {
    slug: 'getting-started',
    group: 'start',
    order: 1,
    title: '开机动画是什么',
    summary: '登录后播放几秒的片头，不是改开机画面',
    html: `
<p>开机动画（BootAnimation）是一个 Windows 小工具：<strong>登录完成之后立刻全屏播放几秒片头，播完自动消失</strong>。它<strong>不是</strong>修改 Windows 开机徽标或开机画面的工具，也不参与开机自检与登录过程 —— 你在开机自检和登录界面上看到的东西，不会因为它有任何改变。</p>

<div class="callout callout--info">
  <div>
    <p><strong>一句话区分：</strong>「开机画面」是系统在登录之前放的；本软件是<strong>桌面出来之后</strong>才播放的片头。所以开机时的徽标、登录界面的样子，都不归它管。</p>
  </div>
</div>

<h2>它到底做了什么</h2>
<ul>
  <li>把播放器复制到 <code>%LOCALAPPDATA%\Programs\BootAnimation\</code>。</li>
  <li>在 <code>HKCU\Software\Microsoft\Windows\CurrentVersion\Run</code> 写一个自启键值 <code>BootAnimation</code>。</li>
  <li>把选片、日志、解出的视频缓存写到 <code>%LOCALAPPDATA%\BootAnimation\</code>。</li>
</ul>
<p>它<strong>不改系统级设置</strong>：不改登录 shell、不装驱动、不碰系统文件；安装、运行、卸载都不需要管理员权限。</p>

<h2>适合谁</h2>
<ul>
  <li>想让自己的机器在每次登录后有一段片头的人。</li>
  <li>自己做了动画、想分享给别人一键安装的人。</li>
</ul>

<h2>内置的四段片头</h2>
<p>四段视频<strong>已经内嵌在程序里</strong>，装完不用再下载素材，离线也能用。不带参数双击程序就会弹出选片窗口。</p>
<dl class="facts">
  <dt>brand</dt><dd>DeepSeek 品牌片头 · 4.62 MB</dd>
  <dt>cyberpunk</dt><dd>DeepSeek 赛博朋克片头 · 6.61 MB</dd>
  <dt>awakening</dt><dd>DeepSeek 数字角色苏醒 · 10.12 MB</dd>
  <dt>startup</dt><dd>DeepSeek 启动问题 · 10.32 MB</dd>
</dl>

<h2>和社区的关系</h2>
<p>本站是社区目录。你可以<strong>浏览、预览、直接下载</strong>别人的动画；装了客户端之后，还能点「装到我的开机动画」一键安装。目录里只存元数据、视频直链和校验哈希，视频由投稿者自己托管，我们不转存。</p>
<div class="callout callout--ok">
  <div>
    <p>目录里的内容<strong>不会被自动装上</strong>：只有你主动选择并确认安装的条目才会被下载和播放。</p>
  </div>
</div>

<p><span class="muted small">当前版本 1.0.0，以 Releases 页面发布的版本为准。</span></p>
`,
  },

  /* ───────────────────────────── 2. start ───────────────────────────── */
  {
    slug: 'installation',
    group: 'start',
    order: 2,
    title: '安装与卸载',
    summary: '一个 exe，不要管理员，先过 SmartScreen',
    html: `
<p>安装只需要一个文件：<code>BootAnimation-Setup.exe</code>（31.71 MB）。播放器和内置的四段片头都打包在里面。</p>

<dl class="facts">
  <dt>需要管理员吗</dt><dd>不需要。安装、运行、卸载都不需要</dd>
  <dt>需要装 .NET 吗</dt><dd>不需要。用的是每台 Windows 都有的 .NET Framework 4.x</dd>
  <dt>需要联网吗</dt><dd>不需要。内置片头就在安装包里</dd>
  <dt>系统要求</dt><dd>Windows 10 / 11，64 位（x64）</dd>
</dl>

<h2>安装步骤</h2>
<ol class="steps">
  <li>双击 <code>BootAnimation-Setup.exe</code>。</li>
  <li><strong>先过 SmartScreen。</strong>安装包<strong>目前没有代码签名</strong>，第一次运行会弹出「Windows 已保护你的电脑」。点<strong>「更多信息」→「仍要运行」</strong>即可。这是微软对未签名程序的默认拦截，不是病毒报警。</li>
  <li>在弹出的窗口里<strong>选一段片头</strong>：<code>brand</code> / <code>cyberpunk</code> / <code>awakening</code> / <code>startup</code>。</li>
  <li>点安装，完成。</li>
</ol>
<div class="callout callout--warn">
  <div>
    <p>没看到「仍要运行」按钮时，说明窗口还没展开：先点「更多信息」那一行文字。如果公司策略直接禁止运行，请让管理员放行，而不是关掉杀毒软件。</p>
  </div>
</div>

<h2>安装程序做了五件事</h2>
<ol>
  <li>释放播放器到 <code>%LOCALAPPDATA%\Programs\BootAnimation\BootAnimation.exe</code></li>
  <li>把选中的片头记到 <code>%LOCALAPPDATA%\BootAnimation\settings.txt</code></li>
  <li>注册开机自启 <code>HKCU\...\CurrentVersion\Run\BootAnimation</code></li>
  <li>在开始菜单建快捷方式（打开选片窗口）</li>
  <li>注册卸载入口 <code>HKCU\...\Uninstall\BootAnimation</code></li>
</ol>
<p>以上全部写在当前用户下，<strong>不写任何系统级设置</strong>。</p>

<h2>装完了在哪看</h2>
<p>「设置 → 应用 → 已安装的应用」里能看到<strong>开机动画</strong>。自启项也会出现在「设置 → 应用 → 启动」和任务管理器的「启动」页里，你随时能自己关掉它。</p>

<h2>卸载</h2>
<p>设置 → 应用 → 已安装的应用 → 开机动画 → 卸载。会删掉程序、自启键值、快捷方式和卸载条目，但<strong>保留</strong> <code>%LOCALAPPDATA%\BootAnimation\</code>：你的选片和日志还在，重装后不用重选。</p>

<h2>静默安装（批量部署用）</h2>
<pre><code>BootAnimation-Setup.exe /SILENT</code></pre>
<p>退出码 <code>0</code> 表示成功。适合远程推送或一次装很多台。</p>
<p><span class="muted small">提示：安装包目前没有代码签名，所以每台机器第一次运行都要手动点一次「仍要运行」。</span></p>
`,
  },

  /* ───────────────────────────── 3. use ───────────────────────────── */
  {
    slug: 'importing-animations',
    group: 'use',
    order: 3,
    title: '装一个社区动画',
    summary: '点「装到我的开机动画」后，客户端做了什么',
    html: `
<p>在社区网站上看到喜欢的动画，点「装到我的开机动画」就行。下面是点下去之后真实发生的事。</p>

<ol class="steps">
  <li><strong>浏览器唤起客户端。</strong>按钮会打开一个 <code>bootanim://install?...</code> 链接，把条目 id、视频直链和 <code>sha256</code> 交给本机的客户端。</li>
  <li><strong>客户端下载视频</strong>，边下边显示进度。</li>
  <li><strong>校验 sha256。</strong>下载完成后客户端会算一遍文件哈希，和条目里的 <code>sha256</code> 比对，不一致就拒绝安装。<span class="muted">这是目录里唯一的完整性校验手段。</span></li>
  <li><strong>保存到 community 目录：</strong><code>%LOCALAPPDATA%\BootAnimation\community\&lt;id&gt;.mp4</code>。</li>
  <li><strong>出现在选片窗口里</strong>，和内置片头一起列出，来源标记为「社区」。选它，它就是你的开机动画。</li>
</ol>

<div class="callout callout--warn">
  <div>
    <p><strong>没装客户端的话，这个按钮不会有任何反应</strong> —— 浏览器不知道 <code>bootanim://</code> 该交给谁。两条路：先装上客户端再点一次；或者点「直接下载」把 mp4 拿到手，再用下面的命令播放。</p>
  </div>
</div>

<h2>用下载到的本地文件播放</h2>
<pre><code>&amp; "$env:LOCALAPPDATA\Programs\BootAnimation\BootAnimation.exe" --file "D:\我的片头.mp4"</code></pre>
<p>这是给外部视频用的试看入口，适合先在自己机器上看看效果，再决定要不要投稿。长期生效的片头以选片窗口里列出的条目为准（内置 + community 目录）。</p>

<h2>换片头 / 再装一个</h2>
<ul>
  <li>不带任何参数双击程序，等同 <code>--choose</code>：弹出选片窗口。</li>
  <li>指定某一段直接播：<code>--clip cyberpunk</code>（可选 <code>brand</code> / <code>cyberpunk</code> / <code>awakening</code> / <code>startup</code>）。</li>
  <li>试看 5 秒，不必等到下次登录：<code>--play --seconds 5</code>。</li>
</ul>

<div class="callout callout--info">
  <div>
    <p>目录里只存「元数据 + 视频链接 + 校验哈希」，视频由投稿者自己托管，我们不转存、也不需要服务器。所以能否下载成功，取决于投稿者那个直链是否还活着。</p>
  </div>
</div>
`,
  },

  /* ───────────────────────────── 4. create ───────────────────────────── */
  {
    slug: 'creating-animations',
    group: 'create',
    order: 4,
    title: '做一个自己的动画',
    summary: '导出参数、ffmpeg 命令与投稿向导',
    html: `
<p>自己做一段并不难：剪一条 5–10 秒的视频，按下面的参数导出，再投到社区。</p>

<h2>导出参数</h2>
<table>
  <thead>
    <tr><th>项目</th><th>建议</th><th>原因</th></tr>
  </thead>
  <tbody>
    <tr><td>容器 / 编码</td><td>mp4，H.264 + AAC</td><td>Windows 自带解码器最稳，兼容性最好</td></tr>
    <tr><td>分辨率</td><td>2560×1440 为主</td><td>社区主流屏幕是 1440p；4K 单个几十 MB，下载明显更慢</td></tr>
    <tr><td>时长</td><td>5–10 秒</td><td>登录后超过 10 秒会让人等得烦</td></tr>
    <tr><td>体积</td><td>≤ 30 MB 体验最好</td><td>用户会挑小的；超过 25 MB 就无法直接拖进投稿表单（要走 Releases 直链），硬上限 2 GB</td></tr>
    <tr><td>索引</td><td>必须 faststart</td><td>否则播放器要读完整个文件才出画面，表现为黑屏卡住</td></tr>
  </tbody>
</table>

<h2>ffmpeg 命令</h2>
<p>只把索引表前置，不重编码，最快：</p>
<pre><code>ffmpeg -i 原片.mp4 -c copy -movflags +faststart 输出.mp4</code></pre>
<p>需要缩放或重新编码时（下面这组参数就是内置四段用的）：</p>
<pre><code>ffmpeg -i 原片.mp4 -vf "unsharp=5:5:0.9:5:5:0.0,scale=2560:1440:flags=lanczos" -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -movflags +faststart -an 输出.mp4</code></pre>
<div class="callout callout--info">
  <div>
    <p>不需要声音就保持上面的 <code>-an</code>；要带音轨就把 <code>-an</code> 换成 <code>-c:a aac</code>。内置四段都是 2560×1440、24fps、无音轨。CRF 取 20 就够了：实测 CRF 20 与 18 的锐度只差一点点，体积却差 10 MB。</p>
  </div>
</div>

<h2>用网站上的投稿向导</h2>
<p>本站首页有「投稿向导」。把 mp4 拖进去，剩下的事在浏览器本地就做完了：</p>
<ul>
  <li>本地算出 <code>sha256</code>（<strong>视频不会上传到我们这里</strong>）。</li>
  <li>读出分辨率、时长、体积，并从视频里抽一帧当预览。</li>
  <li>按社区规范校验：体积超过 2 GB 或时长超过 30 秒会直接标为不合规；超过 25 MB（无法拖进表单）、超过 200 MB、超过 12 秒、或者本身是 4K，会给出提醒。</li>
  <li>生成一份可直接粘进 GitHub 表单的元数据，以及带好参数的投稿链接。</li>
</ul>
<p>先让向导过一遍，能省掉一轮返工。</p>

<div class="callout callout--warn">
  <div>
    <p>别用「逐帧 AI 放大」去补细节。逐帧图片模型会为每一帧想象出不同的微观纹理，连起来就是明显的帧间闪烁（实测闪烁指标从「无」跳到 6.18，属于严重），而对「多加出来的细节层」做时间平滑几乎压不掉这种抖动（实测只压掉 1.8%）。母带本身没有的细节，编码参数也救不回来。真要补细节，用天生带时间维度的视频超分模型。</p>
  </div>
</div>
`,
  },

  /* ───────────────────────────── 5. create ───────────────────────────── */
  {
    slug: 'submission',
    group: 'create',
    order: 5,
    title: '投稿到社区',
    summary: '填一个 Issue，机器人校验后自动上架',
    html: `
<p>投稿是自助的：填一个 Issue，机器人自动校验，通过就上架。目录<strong>不做前置人工审核</strong>，采取「自助投稿 + 事后处置」。</p>

<ol class="steps">
  <li><strong>打开 Issues → 新建 →「投稿开机动画」。</strong></li>
  <li><strong>把 mp4 拖进「视频」框。</strong>GitHub 会自己上传并把链接填好；也可以直接贴一个 https 直链。名称留空就用文件名，标签可以留空。</li>
  <li><strong>选授权方式、填 nsfw、勾两条声明。</strong><code>nsfw</code> 是<strong>必填</strong> —— 漏填会导致条目校验失败，而不是被当成 false。客户端默认隐藏 <code>nsfw: true</code> 的条目，用户可在设置里打开。</li>
  <li><strong>等机器人校验。</strong>它会检查必填字段、视频直链是否可达、文件大小与格式，并核对哈希。</li>
  <li><strong>看结果：</strong>通过 → 自动生成条目文件、刷新 <code>index.json</code>、合并进目录，并在 Issue 里回复「已上架」；不通过 → 在 Issue 里列出缺哪一项，改好重新提交即可。</li>
</ol>

<h2>视频放哪</h2>
<dl class="facts">
  <dt>推荐</dt><dd>自己仓库的 Releases，每个文件最大 2 GB，免费。直链形如 <code>https://github.com/&lt;你&gt;/&lt;仓库&gt;/releases/download/&lt;tag&gt;/&lt;文件&gt;.mp4</code></dd>
  <dt>也可以</dt><dd>任何稳定的 https 直链：对象存储、你自己的 CDN</dd>
  <dt>不合格</dt><dd>网盘分享页。客户端只认直链，不解析网页</dd>
</dl>

<div class="callout callout--info">
  <div>
    <p>预览图是必填字段，但<strong>你不用自己准备</strong>：机器人会从视频里挑最亮的一帧截出来并提交进仓库。用户下载前看到的就是它。</p>
  </div>
</div>

<h2>硬性要求（机器人会卡）</h2>
<ul>
  <li><code>video</code> 和 <code>preview</code> 必须是 <strong>https 直链</strong>。</li>
  <li><code>sha256</code> 必须与文件完全一致 —— 这是唯一的安全校验手段，<strong>改了视频就必须改哈希</strong>。</li>
  <li>体积上限 2 GB（对齐 GitHub Release 的单文件上限）、时长上限 30 秒；建议 1440p、30 MB 以内 —— 4K 原画请走 Releases 直链。</li>
  <li>投稿即表示你声明拥有该视频的权利或已获得授权，并在条目里写明 <code>license</code>（例如 CC-BY-4.0、CC0-1.0）。</li>
</ul>

<h2>举报与下架</h2>
<p>任何人都可以对任何条目提 Issue（选「举报」模板），写明条目 id 与理由。维护者核实后会<strong>直接下架</strong>（删除条目文件 + 刷新索引），必要时封禁投稿者。内容不得含违法、色情、暴力或仇恨内容。</p>
<p><span class="muted small"><code>data/index.json</code> 由机器人从条目文件生成，不要手改；条目格式的任何变更都要保证向后兼容，新字段可选。</span></p>
`,
  },

  /* ───────────────────────────── 6. use ───────────────────────────── */
  {
    slug: 'compatibility',
    group: 'use',
    order: 6,
    title: '兼容性与格式要求',
    summary: 'H.264 最稳，faststart 是硬要求',
    html: `
<p>客户端是 Windows 桌面程序，对视频格式有明确偏好。照下面的来最省事。</p>

<h2>系统与依赖</h2>
<dl class="facts">
  <dt>支持</dt><dd>Windows 10 / 11，64 位（x64）</dd>
  <dt>权限</dt><dd>不需要管理员</dd>
  <dt>依赖</dt><dd>不需要装 .NET 运行时，用的是系统自带的 .NET Framework 4.x</dd>
  <dt>内置片头</dt><dd>2560×1440、24fps，四段合计约 31.7 MB，已内嵌在程序里</dd>
</dl>

<h2>视频格式</h2>
<table>
  <thead>
    <tr><th>格式</th><th>结果</th></tr>
  </thead>
  <tbody>
    <tr><td>H.264 + AAC 的 mp4</td><td><strong>最稳，推荐</strong></td></tr>
    <tr><td>HEVC（H.265）</td><td>可能只有声音，或者干脆黑屏</td></tr>
    <tr><td>ProRes</td><td>同上，Windows 自带解码器不认</td></tr>
    <tr><td>部分 mkv</td><td>可能只有声音或黑屏</td></tr>
  </tbody>
</table>

<div class="callout callout--warn">
  <div>
    <p><strong>faststart 是硬要求。</strong>不加 <code>-movflags +faststart</code> 时索引表在文件末尾，播放器必须把整段读完才出画面 —— 用户看到的就是黑屏卡住。修一条已经做好的片子不用重新编码：<br><code>ffmpeg -i 原片.mp4 -c copy -movflags +faststart 修好的.mp4</code></p>
  </div>
</div>

<h2>分辨率与体积</h2>
<ul>
  <li><strong>1440p（2560×1440）是社区主流</strong>，内置四段也是这个分辨率。</li>
  <li>4K 能跑，但单个文件常常几十 MB，下载明显更慢；社区建议投稿出 1440p。</li>
  <li>建议体积 ≤ 30 MB；硬上限 2 GB（GitHub Release 的单文件上限）。注意：超过 25 MB 就没法直接拖进投稿表单，要先传到自己的 Release 再把直链贴进表单。</li>
</ul>

<h2>音频</h2>
<p>可以带音轨，但客户端默认可能静音 —— 登录后突然出声，对很多人是打扰。内置四段都没有音轨。</p>

<h2>播放参数</h2>
<dl class="facts">
  <dt>铺满</dt><dd><code>--fit cover</code>（默认）：铺满屏幕，可能裁掉边缘</dd>
  <dt>完整显示</dt><dd><code>--fit contain</code>：完整显示，留黑边</dd>
  <dt>不等登录</dt><dd><code>--play --seconds 5</code>：立刻试看 5 秒</dd>
</dl>
`,
  },

  /* ───────────────────────────── 7. support ───────────────────────────── */
  {
    slug: 'troubleshooting',
    group: 'support',
    order: 7,
    title: '排错',
    summary: '先看日志，再动手；常见四类问题',
    html: `
<p>先看日志，再动手。日志里写清了每一次播放的结果，比猜快得多。</p>

<h2>日志和诊断文件在哪</h2>
<dl class="facts">
  <dt>运行日志</dt><dd><code>%LOCALAPPDATA%\BootAnimation\boot-animation.log</code></dd>
  <dt>自检报告</dt><dd><code>%LOCALAPPDATA%\BootAnimation\selftest.txt</code>（含内置四段的哈希）</dd>
  <dt>枚举结果</dt><dd><code>%LOCALAPPDATA%\BootAnimation\clips.txt</code></dd>
  <dt>当前片头</dt><dd><code>%LOCALAPPDATA%\BootAnimation\settings.txt</code></dd>
  <dt>视频缓存</dt><dd><code>%LOCALAPPDATA%\BootAnimation\clips\</code></dd>
</dl>

<p>日志里值得搜的三类内容：</p>
<ul>
  <li><code>MediaOpened</code> —— 含分辨率和「进程启动到出画」的毫秒数，能看出是解码慢还是根本没打开。</li>
  <li><code>MediaFailed</code> —— 含失败原因。格式不被支持，一般在这里现形。</li>
  <li>超时记录 —— 起播迟迟无响应时写入。</li>
</ul>

<div class="callout callout--info">
  <div>
    <p>起播不出画面时，屏幕上本来就有提示：「正在加载…」「播放失败：&lt;原因&gt;」「20 秒无响应」，不会留一块黑屏让你猜。看到哪一条，就对照下面的小节处理。</p>
  </div>
</div>

<h2>动画没播</h2>
<ol class="steps">
  <li>先确认自启还在：任务管理器 →「启动」页，看 <code>BootAnimation</code> 是不是被设成了「已禁用」；「设置 → 应用 → 启动」里也能看。</li>
  <li>手动试一次：<code>--play --seconds 5</code>。能播，说明是自启的问题。</li>
  <li>看日志：这一次有没有写进 <code>MediaOpened</code>。完全没写，说明进程没起来或视频没打开。</li>
</ol>

<h2>播一半卡住</h2>
<p>多半是格式或索引问题。先找日志里的 <code>MediaFailed</code>，再用 faststart 重排一遍索引；仍不行就重编码成 H.264 + AAC 的 mp4。</p>

<h2>只有声音、没有画面</h2>
<p>视频轨用了解码器不认的编码，常见于 HEVC、ProRes 和部分 mkv。把视频轨重编码成 H.264 的 mp4 即可。</p>

<h2>下载校验失败（sha256 不符）</h2>
<p>客户端会直接拒绝安装这种文件，这是设计如此 —— 目录里唯一的完整性校验手段就是 sha256。常见原因是投稿者上传后又换了视频却没更新哈希，或者下载过程被中间设备改过。先重下一次；仍然失败，就去该条目对应的 Issue 反馈，让作者重新提交哈希。</p>

<h2>怀疑是内置片头本身出了问题</h2>
<p>跑一次无界面自检：<code>BootAnimation.exe --selftest</code>。它会解包内嵌视频、算哈希，把报告写到 <code>selftest.txt</code>。</p>
`,
  },

  /* ───────────────────────────── 8. support ───────────────────────────── */
  {
    slug: 'recovery',
    group: 'support',
    order: 8,
    title: '出问题怎么恢复',
    summary: '三条退出路径，怎么只关自启，怎么彻底卸载',
    html: `
<p>最坏的情况也只是「登录后动画挡在屏幕上」，不会让你进不去系统。下面是三条退出路径，以及几种干净的收尾办法。</p>

<div class="callout callout--ok">
  <div>
    <p><strong>随时可退出：</strong>按 <code>Esc</code>，或在画面任意位置点一下。另外，程序最多播到 <strong>5 分钟</strong>就会强制结束，不会一直赖在屏幕上。</p>
  </div>
</div>

<h2>三条脱身路径</h2>
<ol class="steps">
  <li><strong>Esc 或点击画面</strong> —— 最快，先试这个。</li>
  <li><strong>任务管理器</strong> —— <code>Ctrl+Shift+Esc</code> 打开，找到 <code>BootAnimation.exe</code>，结束任务。</li>
  <li><strong>注销</strong> —— <code>Ctrl+Alt+Del</code> → 注销。再登录时它会因为「已经在跑」而被忽略（<code>IgnoreNew</code>），不会又叠一层新的上来。</li>
</ol>

<h2>不想让它开机播了</h2>
<p>下面这条<strong>只手删自启键值</strong>，不删程序，你随时能再打开选片窗口：</p>
<pre><code>Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name BootAnimation</code></pre>
<p>也可以走图形界面：任务管理器 →「启动」→ 把 <code>BootAnimation</code> 设为「已禁用」，或者到「设置 → 应用 → 启动」里关掉。</p>

<h2>正规卸载</h2>
<p>设置 → 应用 → 已安装的应用 → 开机动画 → 卸载。会删掉程序、自启键值、快捷方式和卸载条目；<strong>保留</strong> <code>%LOCALAPPDATA%\BootAnimation\</code>，也就是你的选片、日志和社区视频，重装后原样还在。</p>

<h2>彻底修：安全模式</h2>
<p>如果自启键值删不掉，而你又完全不想让它再跑：进安全模式，删掉 <code>HKCU\Software\Microsoft\Windows\CurrentVersion\Run</code> 下的 <code>BootAnimation</code> 键值，然后正常启动。</p>

<h2>为什么不用「改 Shell 启动项」那种做法</h2>
<p>有一种做法是改注册表里登录用的 Shell 启动项（<code>Winlogon</code> 那一段），把动画塞到桌面出现之前，效果更接近真·开机动画。<strong>本软件刻意不这么做</strong>：那种包装脚本一旦写错，登录后就没有桌面，必须进安全模式才能修。当前方案最多是「动画挡了一下」，代价小得多，也随时能退。</p>
<div class="callout callout--info">
  <div>
    <p>本软件只在登录之后运行：不修改任何系统级设置，也不参与系统启动过程。上面提到 <code>Winlogon</code> 只是为了说明<strong>我们不采用那种做法</strong>。</p>
  </div>
</div>
`,
  },

  /* ───────────────────────────── 9. support ───────────────────────────── */
  {
    slug: 'faq',
    group: 'support',
    order: 9,
    title: '常见问题',
    summary: '10 个最常被问到的问题',
    html: `
<h2>它会改我的开机徽标或开机画面吗？</h2>
<p>不会。它在登录完成、桌面出来之后才播放几秒，然后自动消失。开机自检和登录界面的样子不会因为它有任何改变 —— 它不是「改开机画面」的软件。</p>

<h2>会不会伤系统？</h2>
<p>它只写三处：自己的程序目录、<code>HKCU</code> 下的一个自启键值、以及自己的数据目录。不改系统级设置、不装驱动、不碰系统文件。想退随时能退，最坏情况也只是动画挡了一下屏幕。</p>

<h2>要不要管理员权限？</h2>
<p>不要。安装、运行、卸载都不需要管理员。正因为是写当前用户的自启键值，所以卸载干净利落。</p>

<h2>能用自己的视频吗？</h2>
<p>能。用 <code>--file "D:\我的片头.mp4"</code> 播放任意本地视频试看。想让别人也能用，就按兼容性页面里的参数导出，然后投到社区。</p>

<h2>支持几台电脑？</h2>
<p>软件本身没有账号、没有激活、也没有联网校验，装到哪台 Windows 10 / 11 x64 上都能用。具体授权范围以你取得安装包时看到的说明为准。</p>

<h2>动画太长怎么办？</h2>
<p>用 <code>--seconds 5</code> 限制播放秒数，到点自动关闭。另外自启默认带一个 3 秒延迟，让桌面先铺好再显示。投稿时建议控制在 5–10 秒，超过 10 秒会让人等得烦。</p>

<h2>卸载会删我的片子吗？</h2>
<p>不会。卸载只删程序、自启、快捷方式和卸载条目，<code>%LOCALAPPDATA%\BootAnimation\</code> 是保留的，你的选片、日志和从社区装的视频都还在。想彻底清干净，手动删掉这个目录即可。</p>

<h2>为什么第一次运行会有警告？</h2>
<p>因为安装包<strong>目前没有代码签名</strong>，Windows 的 SmartScreen 会拦一下，弹「Windows 已保护你的电脑」。点「更多信息 → 仍要运行」就能继续。这是微软对未签名程序的默认策略，不是病毒报警。</p>

<h2>能离线用吗？</h2>
<p>能。内置四段片头已经内嵌在程序里，装完不联网也能播。只有从社区装别人的动画时才需要联网下载那个视频。</p>

<h2>会不会拖慢开机？</h2>
<p>播放器要等桌面铺好（自启默认延迟 3 秒）再显示，播几秒就自己退出，不会一直挂在后台。所以它不会挡住登录过程，也不会让你多等很久。</p>
`,
  },

];
