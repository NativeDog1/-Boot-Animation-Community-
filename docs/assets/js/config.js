/**
 * config.js — 站点级配置的**唯一来源**。
 *
 * 两条硬规则：
 *   1. 任何模块都不许把 GitHub / Pages 的 URL 写死在业务代码里 —— 都从这里取。
 *   2. 站点根用 `import.meta.url` 推导，不做构建期注入。这样同一份代码在
 *      GitHub Pages 子路径（/仓库名/）、未来的自定义域（/）、以及本地 serve.mjs
 *      下都能正确解析相对资源，换域名不需要改任何前端代码。
 */

/** 社区仓库（数据与机器人所在）。软件读的是同一个仓库的 data/index.json。 */
export const REPO = 'NativeDog1/-Boot-Animation-Community-';
export const BRANCH = 'main';
export const REPO_URL = `https://github.com/${REPO}`;

/** 站点根 URL。assets/js/config.js → 上两级 = 站点根。 */
export const ROOT = new URL('../../', import.meta.url);

/** 仓库根 URL（GitHub Pages 上不存在 data/，只用于本地开发时的数据回退）。 */
export const REPO_ROOT = new URL('../', ROOT);

export const SITE = {
  name: 'Boot Animation',
  nameZh: '开机动画',
  tagline: 'YOUR BOOT. YOUR IDENTITY.',
  /** 首页与默认 meta description；单页会用更精确的覆盖它。 */
  description:
    '开机动画（Boot Animation）：Windows 登录后全屏播放一段你选的片头。这里是它的官方社区 —— 公开的动画库、投稿流程与完整文档。零服务器、纯静态、视频由作者自己托管。',
  locale: 'zh-CN',
  /** canonical / OG / sitemap 用。换自定义域时只改这一行。 */
  baseUrl: 'https://nativedog1.github.io/-Boot-Animation-Community-/',
  keywords: [
    'Boot Animation',
    'Windows Boot Animation',
    'PC Boot Animation',
    'Custom Boot Animation',
    'Boot Animation Software',
    'Boot Animation Community',
    '开机动画',
    'Windows 开机动画',
  ],
  /** OG 默认图（生成器产出）。 */
  ogImage: 'assets/og.png',
};

/** 配套软件。下载页与「用开机动画打开」都读这里。 */
export const SOFTWARE = {
  name: 'Boot Animation 开机动画',
  repo: 'NativeDog1/boot-animation-app',
  /** 发布入口：永远指向 latest，不硬编码版本号。 */
  releasesUrl: 'https://github.com/NativeDog1/boot-animation-app/releases/latest',
  allReleasesUrl: 'https://github.com/NativeDog1/boot-animation-app/releases',
  /** 可选的版本清单：存在则显示版本/日期/体积，不存在就如实说「尚未发布」。 */
  manifest: 'data/software.json',
  /** 软件自身的安装位置与影响面（文案与 README 一致，不夸大）。 */
  install: {
    dir: '%LOCALAPPDATA%\\Programs\\BootAnimation\\',
    runKey: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\BootAnimation',
    dataDir: '%LOCALAPPDATA%\\BootAnimation\\',
    admin: false,
    touchesBoot: false,
  },
  requirements: {
    os: 'Windows 10 / 11（x64）',
    runtime: '不需要装 .NET 运行时（用系统自带的 .NET Framework 4.x）',
    disk: '约 40 MB（含四段内嵌片头）',
    admin: '不需要管理员权限',
  },
};

/** 网页唤起客户端用的自定义协议。客户端侧由 Community.cs 解析。 */
export const DEEP_LINK = {
  scheme: 'bootanim',
  /** 试图唤起后等多久判定「没装客户端」。 */
  probeMs: 1800,
};

/** 目录缓存时长（sessionStorage）。太短会反复打 GitHub，太长会让人看不到新投稿。 */
export const CATALOG_TTL_MS = 3 * 60 * 1000;

/** 目录的远端候选源，**按顺序**尝试（不是竞速）。 */
export function catalogSources() {
  return [
    `https://raw.githubusercontent.com/${REPO}/${BRANCH}/data/index.json`,
    `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/data/index.json`,
  ];
}

/** 站点内资源的绝对 URL（用于 JS 里拼图片/页面地址）。 */
export function rootUrl(path = '') {
  return new URL(String(path).replace(/^\/+/, ''), ROOT).href;
}

/** 站点内路径（root-absolute），适合放进 href。 */
export function rootPath(path = '') {
  return new URL(String(path).replace(/^\/+/, ''), ROOT).pathname;
}

/** 用于 canonical / OG / sitemap 的绝对地址。 */
export function siteUrl(path = '') {
  return new URL(String(path).replace(/^\/+/, ''), SITE.baseUrl).href;
}

/** 仓库内文件的 raw 直链（预览图等）。 */
export function rawUrl(path) {
  return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${String(path).replace(/^\/+/, '')}`;
}

/** 提 Issue 的入口。 */
export function issueUrl(template, params = {}) {
  const p = new URLSearchParams({ template });
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v));
  return `${REPO_URL}/issues/new?${p.toString()}`;
}
