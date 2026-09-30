/**
 * build-site.mjs — 把 data/index.json + 文档内容**预渲染成静态页面**。
 *
 * 为什么必须预渲染（而不是纯客户端路由）：
 *   1. GitHub Pages 上刷新 /animations/<id>/ 不会 404 —— 它是真文件；
 *   2. 每个动画有自己的 <title>/description/canonical/OG/JSON-LD，爬虫与分享卡片才有内容；
 *   3. 禁用 JS 也能把目录读完（JS 只负责筛选、预览、深链这些增强）。
 *
 * 运行：node tools/build-site.mjs
 * 产出：docs/ 下的页面 + sitemap.xml + robots.txt + 搜索索引 + 404.html
 *
 * 零依赖、零网络：只读仓库里的文件。CI 里由投稿机器人在同一次提交里调用。
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const DOCS = join(REPO_ROOT, 'docs');

const SITE = {
  name: 'Boot Animation',
  nameZh: '开机动画',
  tagline: 'YOUR BOOT. YOUR IDENTITY.',
  baseUrl: 'https://nativedog1.github.io/-Boot-Animation-Community-/',
  repo: 'NativeDog1/-Boot-Animation-Community-',
  softwareRepo: 'NativeDog1/boot-animation-app',
  locale: 'zh-CN',
  description:
    '开机动画（Boot Animation）：Windows 登录后全屏播放一段你选的片头。这里是它的官方社区 —— 公开的动画库、投稿流程与完整文档。零服务器、纯静态、视频由作者自己托管。',
};

/* ─────────────────────────── 小工具 ─────────────────────────── */

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const attr = (s) => esc(s);

/** 页面深度 → 相对前缀。depth 1 = docs 根。 */
function prefix(depth) {
  return depth <= 1 ? './' : '../'.repeat(depth - 1);
}

function write(relPath, content) {
  const target = join(DOCS, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
  return target;
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function formatBytes(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return '';
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(0) + ' KB';
  return (v / 1024 / 1024).toFixed(1) + ' MB';
}

function humanDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? `${Number(m[1])} 年 ${Number(m[2])} 月 ${Number(m[3])} 日` : '';
}

/* ─────────────────────────── 站点外壳 ─────────────────────────── */

const NAV = [
  { href: 'animations/', label: '动画库' },
  { href: 'community/', label: '社区' },
  { href: 'download/', label: '下载' },
  { href: 'docs/', label: '文档' },
  { href: 'creators/', label: '作者' },
];

const NAV_EXTRA = [
  { href: 'about/', label: '关于' },
  { href: 'changelog/', label: '更新日志' },
];

const BRAND_MARK = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6.5h16v11H4z" stroke="#fff" stroke-width="1.6"/><path d="M9.5 10.2v3.6l4.2-1.8z" fill="#fff"/></svg>`;

function header(depth, current) {
  const p = prefix(depth);
  const links = NAV.map((n) => {
    const active = current && n.href.startsWith(current) ? ' aria-current="page"' : '';
    return `<a class="nav__link" href="${p}${n.href}"${active}>${n.label}</a>`;
  }).join('');
  return `<header class="site-header">
  <div class="site-header__inner">
    <a class="brand" href="${p}" aria-label="${attr(SITE.name)} 首页">
      <span class="brand__mark">${BRAND_MARK}</span>
      <span class="brand__text"><span class="brand__name">${SITE.name}</span><span class="brand__sub">${SITE.nameZh}</span></span>
    </a>
    <nav class="nav" aria-label="主导航">${links}</nav>
    <div class="header-actions">
      <button class="search-trigger" id="ba-search" type="button" aria-label="搜索（Ctrl+K）">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <span class="search-trigger__text">搜索</span>
        <span class="search-trigger__kbd"><kbd>Ctrl</kbd><kbd>K</kbd></span>
      </button>
      <a class="btn btn--primary btn--sm" href="${p}download/">下载软件</a>
      <button class="icon-btn burger" id="ba-burger" type="button" aria-label="打开菜单" aria-expanded="false" aria-controls="ba-mobile-nav">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg>
      </button>
    </div>
  </div>
</header>
<nav class="mobile-nav" id="ba-mobile-nav" hidden aria-label="移动端导航"></nav>`;
}

function footer(depth) {
  const p = prefix(depth);
  const col = (title, items) => `<div class="site-footer__col"><h4>${title}</h4><ul>${items
    .map((i) => `<li><a href="${i.href}">${i.label}</a></li>`)
    .join('')}</ul></div>`;
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="site-footer__grid">
      <div class="site-footer__col">
        <h4>${SITE.name}</h4>
        <p class="muted small">${SITE.tagline}<br>登录后播放几秒的开机片头，配一个公开的社区动画库。</p>
      </div>
      ${col('产品', [
        { href: `${p}download/`, label: '下载软件' },
        { href: `${p}animations/`, label: '动画库' },
        { href: `${p}community/`, label: '社区与投稿' },
        { href: `${p}changelog/`, label: '更新日志' },
      ])}
      ${col('文档', [
        { href: `${p}docs/getting-started/`, label: '快速开始' },
        { href: `${p}docs/installation/`, label: '安装与卸载' },
        { href: `${p}docs/importing-animations/`, label: '装一个社区动画' },
        { href: `${p}docs/recovery/`, label: '出问题怎么恢复' },
      ])}
      ${col('社区', [
        { href: `https://github.com/${SITE.repo}`, label: '数据仓库' },
        { href: `https://github.com/${SITE.repo}/blob/main/SCHEMA.md`, label: '条目规范' },
        { href: `https://github.com/${SITE.repo}/issues/new?template=submit-animation.yml`, label: '投稿' },
        { href: `https://github.com/${SITE.repo}/issues/new?template=report.yml`, label: '举报内容' },
      ])}
    </div>
    <div class="site-footer__bottom">
      <span>数据来自 GitHub 仓库，视频由各自作者托管；本站没有服务器，也不做转存。</span>
      <span id="ba-source" class="mono"></span>
    </div>
  </div>
</footer>`;
}

/**
 * 组装一整页。
 * @param {object} o
 * @param {number} o.depth 目录深度（docs 根 = 1）
 * @param {string} o.rel    相对站点根的路径，例如 'animations/index.html'
 * @param {object} o.head   { title, description, ogType, ogImage, jsonLd, robots }
 * @param {string} o.body   主内容 HTML
 * @param {string} o.current 当前栏目前缀，用于导航高亮
 * @param {object} [o.bodyAttrs] 额外 body 属性
 */
function page(o) {
  const p = prefix(o.depth);
  const canonical = new URL(o.rel.replace(/index\.html$/, ''), SITE.baseUrl).href;
  const fullTitle = o.head.title === SITE.name ? `${SITE.name} — ${SITE.nameZh}社区与软件下载` : `${o.head.title} · ${SITE.name}`;
  const desc = o.head.description || SITE.description;
  const ogImage = o.head.ogImage || '';
  const jsonLd = o.head.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(o.head.jsonLd)}</script>`
    : '';
  const bodyAttrs = Object.entries({ 'data-page': 'static', ...(o.bodyAttrs || {}) })
    .map(([k, v]) => ` ${k}="${attr(v)}"`)
    .join('');

  return `<!DOCTYPE html>
<html lang="${SITE.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${o.head.base ? `<base href="${attr(o.head.base)}">` : ''}
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(desc)}">
<link rel="canonical" href="${attr(canonical)}">
${o.head.robots ? `<meta name="robots" content="${attr(o.head.robots)}">` : ''}
<meta property="og:type" content="${attr(o.head.ogType || 'website')}">
<meta property="og:site_name" content="${attr(SITE.name)}">
<meta property="og:title" content="${attr(fullTitle)}">
<meta property="og:description" content="${attr(desc)}">
<meta property="og:url" content="${attr(canonical)}">
<meta property="og:locale" content="zh_CN">
${ogImage ? `<meta property="og:image" content="${attr(ogImage)}">` : ''}
<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${attr(fullTitle)}">
<meta name="twitter:description" content="${attr(desc)}">
${ogImage ? `<meta name="twitter:image" content="${attr(ogImage)}">` : ''}
<meta name="theme-color" content="#0a0b0d">
<link rel="icon" href="${p}assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${p}assets/css/tokens.css">
<link rel="stylesheet" href="${p}assets/css/base.css">
<link rel="stylesheet" href="${p}assets/css/components.css">
${jsonLd}
</head>
<body${bodyAttrs}>
<a class="skip" href="#ba-main">跳到主内容</a>
${header(o.depth, o.current)}
<main id="ba-main">
${o.body}
</main>
${footer(o.depth)}
<script type="module" src="${p}assets/js/app.js"></script>
</body>
</html>
`;
}

/* ─────────────────────────── 卡片（静态版） ─────────────────────────── */

function staticCard(e, p, { priority = false } = {}) {
  const href = `${p}animations/${encodeURIComponent(String(e.id))}/`;
  const res = e.width && e.height ? `${e.width}×${e.height}` : '';
  const dur = e.duration ? `${Number(e.duration).toFixed(1)} 秒` : '';
  const badgesTop = [
    e.nsfw ? '<span class="badge badge--nsfw">不适宜内容</span>' : '',
  ].filter(Boolean).join('');
  const badgesBottom = [
    res ? `<span class="badge badge--res">${esc(res)}</span>` : '',
    dur ? `<span class="badge badge--dur">${esc(dur)}</span>` : '',
  ].filter(Boolean).join('');
  const meta = [e.author, formatBytes(e.bytes), e.fps ? `${e.fps} fps` : ''].filter(Boolean).join(' · ');
  const tags = (e.tags || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('');

  const thumb = e.preview
    ? `<img src="${attr(e.preview)}" alt="" loading="${priority ? 'eager' : 'lazy'}" decoding="async"${priority ? ' fetchpriority="high"' : ''}>`
    : `<div class="thumb-fallback"><span>作者没有提供预览图</span></div>`;

  return `<a class="card card--link" href="${href}" aria-label="${attr((e.name || e.id) + (e.author ? ' — ' + e.author : ''))}">
  <div class="card__thumb">${thumb}
    ${badgesTop ? `<div class="card__badges card__badges--top">${badgesTop}</div>` : ''}
    ${badgesBottom ? `<div class="card__badges">${badgesBottom}</div>` : ''}
  </div>
  <div class="card__body">
    <h3 class="card__title">${esc(e.name || e.id)}</h3>
    ${meta ? `<p class="card__meta">${esc(meta)}</p>` : ''}
    ${e.description ? `<p class="card__desc">${esc(e.description)}</p>` : ''}
    ${tags ? `<div class="card__tags">${tags}</div>` : ''}
    <div class="card__foot"><span class="muted small">${esc(e.submitted || '')}</span></div>
  </div>
</a>`;
}

/* ─────────────────────────── 各页面模板 ─────────────────────────── */

function homePage(entries, p) {
  const newest = entries.slice().sort((a, b) => String(b.submitted || '').localeCompare(String(a.submitted || '')));
  const authors = new Set(entries.map((e) => e.author).filter(Boolean));
  const hasData = entries.length > 0;
  const ogImage = entries.find((e) => e.preview)?.preview || '';

  const facts = hasData
    ? `<div class="hero__facts">
      <div class="hero__fact"><b>${entries.length}</b><span>社区动画</span></div>
      <div class="hero__fact"><b>${authors.size}</b><span>位作者</span></div>
      <div class="hero__fact"><b>0 元</b><span>软件价格</span></div>
    </div>`
    : '';

  const featured = hasData
    ? `<div class="grid">${newest.slice(0, 3).map((e, i) => staticCard(e, p, { priority: i === 0 })).join('')}</div>`
    : `<div class="state"><h3 class="state__title">目录里还没有动画</h3><p class="state__text">这个库靠投稿长起来 —— 你手上那段片头可以是第一条。</p><button class="btn btn--primary" type="button" data-open-wizard>我要投稿</button></div>`;

  return `<section class="hero">
  <div class="wrap">
    <div class="hero__grid">
      <div>
        <span class="eyebrow">Windows 10 / 11 · 免管理员</span>
        <h1 class="hero__title">BOOT ANIMATION<span>YOUR BOOT. YOUR IDENTITY.</span></h1>
        <p class="hero__lead">登录 Windows 后立刻全屏播放一段你选的片头，播完自动消失。<b>不改开机画面、不碰引导、不要管理员权限</b> —— 随时按 Esc 就退出。挑一段现成的，或者做一个自己的。</p>
        <div class="hero__cta">
          <a class="btn btn--primary btn--lg" href="${p}download/">
            <svg class="btn__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5.5l7.5-1v7H3zM12.5 4.2L21 3v8.5h-8.5zM3 12.5h7.5v7L3 18.5zM12.5 12.5H21V21l-8.5-1.2z"/></svg>
            下载软件
          </a>
          <a class="btn btn--lg" href="${p}animations/">浏览动画库</a>
        </div>
        ${facts}
      </div>
      <div class="hero__media">
        <div class="player">
          ${ogImage
            ? `<img class="player__poster" src="${attr(ogImage)}" alt="社区动画预览" loading="eager" fetchpriority="high" style="cursor:default">`
            : `<div class="thumb-fallback"><span>社区还没有动画</span></div>`}
          <div class="player__state">社区最新的一段片头 · 详情页可以点开播放</div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section section--tight">
  <div class="wrap">
    <div class="section__head">
      <div>
        <h2 class="section__title">最新上架</h2>
        <p class="section__sub">目录里的内容全部来自公开投稿。这里没有编辑推荐位，也没有编造的下载量。</p>
      </div>
      <a class="btn btn--sm" href="${p}animations/">全部 ${entries.length} 个</a>
    </div>
    <div id="ba-home-featured">${featured}</div>
    <p class="muted small" id="ba-home-status" style="margin-top:var(--s-3)"></p>
    <div class="hero__facts" id="ba-home-stats" style="border:0;padding:0;margin-top:var(--s-4)"></div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head"><div>
      <h2 class="section__title">软件做什么，不做什么</h2>
      <p class="section__sub">开机动画动的是你每天都会看到的那几秒，所以先把边界说清楚。</p>
    </div></div>
    <div id="ba-home-software"></div>
    <div class="btn-row" style="margin-top:var(--s-5)">
      <a class="btn btn--primary" href="${p}download/">下载 / 自行构建</a>
      <a class="btn" href="${p}docs/compatibility/">兼容性与格式要求</a>
      <a class="btn btn--ghost" href="${p}docs/recovery/">出问题怎么恢复</a>
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="section__head"><div>
      <h2 class="section__title">社区怎么运作</h2>
      <p class="section__sub">没有服务器、没有账号系统、没有数据库 —— 全靠 GitHub 的免费基础设施。</p>
    </div></div>
    <div class="grid grid--wide">
      <div class="card"><div class="card__body">
        <h3 class="card__title">1 · 投稿是一条 Issue</h3>
        <p class="card__desc">浏览器先帮你把哈希、分辨率、时长、预览图算好，再打开预填好的 GitHub 表单。机器人校验通过就自动上架。</p>
      </div></div>
      <div class="card"><div class="card__body">
        <h3 class="card__title">2 · 数据就是一个 JSON</h3>
        <p class="card__desc">目录是仓库里的 <code>data/index.json</code>。网站读它，客户端也读它 —— 同一份数据，同一个 id。</p>
      </div></div>
      <div class="card"><div class="card__body">
        <h3 class="card__title">3 · 视频由作者托管</h3>
        <p class="card__desc">我们不转存、不代理、不限速。客户端下载后用 sha256 校验，不符就拒绝安装。</p>
      </div></div>
    </div>
    <div class="btn-row" style="margin-top:var(--s-5)">
      <button class="btn btn--primary" type="button" data-open-wizard>投稿一个动画</button>
      <a class="btn" href="${p}community/">看社区与投稿流程</a>
    </div>
  </div>
</section>
`;
}

function libraryPage(entries, p) {
  const sorted = entries.slice().sort((a, b) => String(b.submitted || '').localeCompare(String(a.submitted || '')));
  const cards = sorted.map((e) => staticCard(e, p, { priority: sorted.indexOf(e) < 4 })).join('');
  return `<section class="section section--tight">
  <div class="wrap">
    <nav class="breadcrumb" aria-label="面包屑"><a href="${p}">首页</a><span class="breadcrumb__sep">/</span><span>动画库</span></nav>
    <div class="section__head">
      <div>
        <h1 class="section__title">动画库</h1>
        <p class="section__sub">社区公开投稿的开机动画。点开任意一个可以预览、下载，或者直接唤起客户端安装。</p>
      </div>
      <div class="btn-row">
        <button class="btn btn--primary" type="button" data-open-wizard>投稿动画</button>
      </div>
    </div>
    <div id="ba-filters" class="stack" style="margin-bottom:var(--s-5)"></div>
    <p class="muted small" id="ba-status" style="margin-bottom:var(--s-4)"></p>
    <div id="ba-grid" class="grid">${cards}</div>
    <div class="btn-row" style="justify-content:center;margin-top:var(--s-6)">
      <button class="btn" id="ba-more" type="button" hidden>继续加载</button>
    </div>
    <p id="ba-empty" class="muted small" hidden></p>
  </div>
</section>
`;
}

function detailPage(e, related, p, depth) {
  const res = e.width && e.height ? `${e.width}×${e.height}` : '';
  const facts = [
    ['作者', e.author],
    ['分辨率', res],
    ['帧率', e.fps ? `${e.fps} fps` : ''],
    ['时长', e.duration ? `${Number(e.duration).toFixed(1)} 秒` : ''],
    ['体积', formatBytes(e.bytes)],
    ['许可', e.license],
    ['上架日期', humanDate(e.submitted)],
  ].filter(([, v]) => v);
  const tags = (e.tags || []).map((t) => `<a class="tag" href="${p}animations/?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join(' ');

  return `<section class="section section--tight">
  <div class="wrap">
    <nav class="breadcrumb" aria-label="面包屑">
      <a href="${p}">首页</a><span class="breadcrumb__sep">/</span>
      <a href="${p}animations/">动画库</a><span class="breadcrumb__sep">/</span>
      <span>${esc(e.name || e.id)}</span>
    </nav>
    <div class="detail-layout" style="display:grid;grid-template-columns:minmax(0,1.5fr) minmax(300px,1fr);gap:var(--s-6);align-items:start">
      <div class="stack">
        <div id="ba-player">
          <div class="player">
            ${e.preview
              ? `<img class="player__poster" src="${attr(e.preview)}" alt="${attr(e.name || '')} 预览" loading="eager" fetchpriority="high">`
              : `<div class="thumb-fallback"><span>作者没有提供预览图</span></div>`}
            <div class="player__play"><span><svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg></span></div>
            <div class="player__state">点一下播放预览 · 不会自动下载视频</div>
          </div>
        </div>
        <div class="callout callout--info" id="ba-deeplink-note" hidden></div>
        <div>
          <h2 style="margin-bottom:var(--s-2)">怎么装到自己的电脑上</h2>
          <div id="ba-import" class="stack stack--tight"></div>
        </div>
        <div>
          <h2 style="margin-bottom:var(--s-3)">相关</h2>
          <div id="ba-related">
            ${related.length
              ? `<div class="grid">${related.map((r) => staticCard(r, p)).join('')}</div>`
              : `<p class="muted small">目录里还没有相关的动画。</p>`}
          </div>
        </div>
      </div>
      <aside class="stack">
        <h1 style="margin-bottom:var(--s-1)">${esc(e.name || e.id)}</h1>
        ${e.description ? `<p class="muted">${esc(e.description)}</p>` : ''}
        <div class="btn-row" id="ba-actions"></div>
        ${tags ? `<div class="card__tags">${tags}</div>` : ''}
        <dl class="facts" id="ba-facts">
          ${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}
        </dl>
        <div id="ba-sha"></div>
        <div class="callout callout--info">
          <div><b>安装前会校验。</b> 客户端下载完会用 sha256 比对这份哈希，不一致就拒绝安装 —— 这样即使链接指向的文件被替换过，也不会装进你的系统。</div>
        </div>
      </aside>
    </div>
  </div>
</section>
`;
}

function communityPage(entries, p) {
  return `<section class="section section--tight">
  <div class="wrap">
    <nav class="breadcrumb" aria-label="面包屑"><a href="${p}">首页</a><span class="breadcrumb__sep">/</span><span>社区</span></nav>
    <div class="section__head">
      <div>
        <h1 class="section__title">社区</h1>
        <p class="section__sub" id="ba-community-status"></p>
      </div>
      <div class="btn-row">
        <button class="btn btn--primary" type="button" data-open-wizard>投稿动画</button>
        <a class="btn" href="${p}creators/">作者</a>
      </div>
    </div>
    <h2>最新上架</h2>
    <div id="ba-community-latest" style="margin-bottom:var(--s-7)"></div>
    <h2>作者</h2>
    <div id="ba-community-creators" style="margin-bottom:var(--s-7)"></div>
    <h2>投稿流程</h2>
    <div id="ba-community-guide"></div>
  </div>
</section>
`;
}

function creatorsPage(p) {
  return `<section class="section section--tight">
  <div class="wrap">
    <nav class="breadcrumb" aria-label="面包屑"><a href="${p}">首页</a><span class="breadcrumb__sep">/</span><span>作者</span></nav>
    <h1>作者</h1>
    <div id="ba-main-inner" hidden></div>
    <div id="ba-creators-note" class="muted small"></div>
  </div>
</section>
`;
}

function creatorPage(creator, entries, p) {
  return `<section class="section section--tight">
  <div class="wrap">
    <nav class="breadcrumb" aria-label="面包屑">
      <a href="${p}">首页</a><span class="breadcrumb__sep">/</span>
      <a href="${p}creators/">作者</a><span class="breadcrumb__sep">/</span><span>${esc(creator)}</span>
    </nav>
    <div id="ba-creator-head" style="margin-bottom:var(--s-5)"></div>
    <div id="ba-creator-list">
      <div class="grid">${entries.map((e) => staticCard(e, p)).join('')}</div>
    </div>
  </div>
</section>
`;
}

function downloadPage(p) {
  return `<section class="section section--tight">
  <div class="wrap">
    <nav class="breadcrumb" aria-label="面包屑"><a href="${p}">首页</a><span class="breadcrumb__sep">/</span><span>下载</span></nav>
    <div class="section__head">
      <div>
        <h1 class="section__title">下载开机动画</h1>
        <p class="section__sub">Windows 10 / 11（x64）· 不需要管理员权限 · 不需要安装 .NET 运行时</p>
      </div>
    </div>
    <div id="ba-dl-version" style="margin-bottom:var(--s-4)"></div>
    <div class="btn-row" id="ba-dl-actions" style="margin-bottom:var(--s-6)"></div>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--s-6);align-items:start" class="detail-layout">
      <div>
        <h2>版本与运行环境</h2>
        <div id="ba-dl-facts"></div>
      </div>
      <div>
        <h2>安装前需要知道</h2>
        <div class="callout callout--warn">
          <div><b>第一次运行会有 SmartScreen 提示。</b> 安装包目前没有代码签名，Windows 会显示「Windows 已保护你的电脑」。点「更多信息 → 仍要运行」即可。这是微软的信任机制，不是检测到了病毒。</div>
        </div>
        <div class="callout callout--info">
          <div><b>它只动三个地方，都不要管理员：</b> 程序目录、一条 <code>HKCU</code> 自启键值、以及一个数据目录（选片与日志，卸载时保留）。不改引导、不改登录外壳、不装驱动。</div>
        </div>
        <div id="ba-dl-notes"></div>
      </div>
    </div>
  </div>
</section>
`;
}

function docsIndexPage(docs, groups, p) {
  const byGroup = groups.map((g) => {
    const items = docs.filter((d) => d.group === g.id).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!items.length) return '';
    return `<h2>${esc(g.label)}</h2>
    <div class="grid grid--wide">${items.map((d) => `<a class="card card--link" href="${p}docs/${d.slug}/">
      <div class="card__body"><h3 class="card__title">${esc(d.title)}</h3><p class="card__desc">${esc(d.summary || '')}</p></div>
    </a>`).join('')}</div>`;
  }).join('');
  return `<section class="section section--tight">
  <div class="wrap wrap--narrow">
    <nav class="breadcrumb" aria-label="面包屑"><a href="${p}">首页</a><span class="breadcrumb__sep">/</span><span>文档</span></nav>
    <h1>文档</h1>
    <p class="muted">从装上到出问题怎么恢复，都在这里。没找到答案就去仓库提 Issue。</p>
    ${byGroup}
  </div>
</section>
`;
}

function docPage(doc, docs, groups, p) {
  const siblings = docs.filter((d) => d.group === doc.group).sort((a, b) => (a.order || 0) - (b.order || 0));
  const nav = groups.map((g) => {
    const items = docs.filter((d) => d.group === g.id).sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!items.length) return '';
    return `<h4>${esc(g.label)}</h4><ul>${items.map((d) => `<li><a href="${p}docs/${d.slug}/"${d.slug === doc.slug ? ' aria-current="page"' : ''}>${esc(d.title)}</a></li>`).join('')}</ul>`;
  }).join('');
  const idx = docs.findIndex((d) => d.slug === doc.slug);
  const prev = docs[idx - 1];
  const next = docs[idx + 1];
  return `<section class="section section--tight">
  <div class="wrap">
    <nav class="breadcrumb" aria-label="面包屑">
      <a href="${p}">首页</a><span class="breadcrumb__sep">/</span>
      <a href="${p}docs/">文档</a><span class="breadcrumb__sep">/</span><span>${esc(doc.title)}</span>
    </nav>
    <div class="docs-layout">
      <nav class="docs-nav" aria-label="文档目录">${nav}</nav>
      <article class="prose">
        <h1>${esc(doc.title)}</h1>
        ${doc.summary ? `<p class="muted">${esc(doc.summary)}</p>` : ''}
        ${doc.html}
        <hr>
        <div class="btn-row" style="justify-content:space-between">
          ${prev ? `<a class="btn" href="${p}docs/${prev.slug}/">← ${esc(prev.title)}</a>` : '<span></span>'}
          ${next ? `<a class="btn" href="${p}docs/${next.slug}/">${esc(next.title)} →</a>` : '<span></span>'}
        </div>
        <p class="muted small" style="margin-top:var(--s-4)">这篇没解决你的问题？去 <a class="link" href="https://github.com/${SITE.repo}/issues/new" target="_blank" rel="noopener">仓库提 Issue</a>，或者先看 <a class="link" href="${p}docs/troubleshooting/">排错</a> 与 <a class="link" href="${p}docs/recovery/">恢复</a>。</p>
      </article>
    </div>
  </div>
</section>
`;
}

function aboutPage(p) {
  return `<section class="section section--tight">
  <div class="wrap wrap--narrow prose">
    <nav class="breadcrumb" aria-label="面包屑"><a href="${p}">首页</a><span class="breadcrumb__sep">/</span><span>关于</span></nav>
    <h1>关于这个项目</h1>
    <p>开机动画（Boot Animation）是一个 Windows 小工具：登录后立刻全屏播放一段你选的片头，播完自动消失。它不修改开机画面、不碰系统引导、不需要管理员权限 —— 任何时刻按 <kbd>Esc</kbd> 或点一下画面就退出。</p>
    <p>这个网站是它的官方社区：一个公开的动画库、一套自助投稿流程，以及完整文档。</p>
    <h2>为什么没有服务器</h2>
    <div class="callout callout--info"><div>作者是学生，第一阶段没有服务器预算。所以整套系统只建立在免费基础设施上：<b>GitHub 仓库</b>存数据、<b>GitHub Pages</b>发布网站、<b>GitHub Releases</b>托管视频与软件、<b>GitHub Actions</b>跑投稿校验。网站是纯静态的，视频由各自动作者自己托管，我们既不转存也不代理。</div></div>
    <h2>架构（一句话版）</h2>
    <pre><code>data/index.json  ──┬──> 网站（读它渲染动画库）
                   └──> 客户端（读它列出社区动画）
同一个 Animation ID = &lt;owner&gt;__&lt;slug&gt;</code></pre>
    <h2>许可与内容</h2>
    <p>目录采用自助投稿 + 事后处置：每条投稿都要声明许可与是否含不适宜内容，任何人对任何条目都可以提举报 Issue，核实后下架。</p>
    <h2>链接</h2>
    <ul>
      <li><a class="link" href="https://github.com/${SITE.repo}" target="_blank" rel="noopener">数据与网站仓库</a></li>
      <li><a class="link" href="https://github.com/${SITE.softwareRepo}" target="_blank" rel="noopener">软件源码仓库</a></li>
      <li><a class="link" href="https://github.com/${SITE.repo}/blob/main/SCHEMA.md" target="_blank" rel="noopener">条目字段规范</a></li>
    </ul>
  </div>
</section>
`;
}

function changelogPage(p) {
  return `<section class="section section--tight">
  <div class="wrap wrap--narrow prose">
    <nav class="breadcrumb" aria-label="面包屑"><a href="${p}">首页</a><span class="breadcrumb__sep">/</span><span>更新日志</span></nav>
    <h1>更新日志</h1>
    <p class="muted">软件版本与发布日期以 GitHub Releases 为准 —— 这里不复制版本号，避免和实际发布脱节。</p>
    <div class="btn-row">
      <a class="btn btn--primary" href="https://github.com/${SITE.softwareRepo}/releases" target="_blank" rel="noopener">软件 Releases</a>
      <a class="btn" href="https://github.com/${SITE.repo}/commits/main" target="_blank" rel="noopener">网站与目录的提交记录</a>
    </div>
    <h2>网站自身的改动</h2>
    <p>网站与目录是同一次提交一起更新的：目录 <code>data/index.json</code> 变了，页面就在同一次 GitHub Actions 里重新生成、随 Pages 一起发布。想看具体改了什么，看上面第二个链接。</p>
  </div>
</section>
`;
}

function notFoundPage(p) {
  return `<section class="section">
  <div class="wrap" style="max-width:640px;text-align:center">
    <h1 style="font-size:var(--t-hero);margin-bottom:var(--s-3)">404</h1>
    <p class="muted" style="margin-bottom:var(--s-5)">这个地址没有对应页面。可能是动画被下架了，或者链接抄错了一段。</p>
    <div class="btn-row" style="justify-content:center">
      <a class="btn btn--primary" href="${p}animations/">去动画库</a>
      <a class="btn" href="${p}">回首页</a>
      <a class="btn btn--ghost" href="${p}docs/">看文档</a>
    </div>
  </div>
</section>
`;
}

/* ─────────────────────────── 主流程 ─────────────────────────── */

async function loadDocs() {
  const path = join(DOCS, 'content', 'docs.mjs');
  if (!existsSync(path)) {
    console.warn('[build-site] 没有 docs/content/docs.mjs —— 文档页将跳过');
    return { docs: [], groups: [] };
  }
  try {
    const mod = await import(pathToFileURL(path).href + `?t=${Date.now()}`);
    return { docs: mod.DOCS || [], groups: mod.DOC_GROUPS || [] };
  } catch (error) {
    console.error('[build-site] 文档内容模块导入失败：', error.message);
    return { docs: [], groups: [] };
  }
}

async function main() {
  const entries = readJson(join(REPO_ROOT, 'data', 'index.json'), []);
  if (!Array.isArray(entries)) throw new Error('data/index.json 不是数组');
  const { docs, groups } = await loadDocs();
  console.log(`[build-site] 目录 ${entries.length} 条 · 文档 ${docs.length} 篇`);

  const written = [];
  const track = (rel, content) => { write(rel, content); written.push(rel); };

  /* 首页 */
  track('index.html', page({
    depth: 1, rel: 'index.html', current: '',
    head: {
      title: SITE.name,
      description: SITE.description,
      ogImage: entries.find((e) => e.preview)?.preview || '',
      jsonLd: {
        '@context': 'https://schema.org', '@type': 'WebSite',
        name: SITE.name, alternateName: `${SITE.name} ${SITE.nameZh}`,
        url: SITE.baseUrl, inLanguage: 'zh-CN',
        description: SITE.description,
      },
    },
    body: homePage(entries, './'),
    bodyAttrs: { 'data-page': 'home' },
  }));

  /* 动画库 */
  track('animations/index.html', page({
    depth: 2, rel: 'animations/index.html', current: 'animations/',
    head: {
      title: '动画库',
      description: `社区公开投稿的开机动画，共 ${entries.length} 个。可预览、可下载，也能一键唤起客户端安装。`,
      jsonLd: {
        '@context': 'https://schema.org', '@type': 'CollectionPage',
        name: '动画库', url: new URL('animations/', SITE.baseUrl).href,
      },
    },
    body: libraryPage(entries, '../'),
    bodyAttrs: { 'data-page': 'animations' },
  }));

  /* 每个动画一页 */
  for (const e of entries) {
    const rel = `animations/${e.id}/index.html`;
    const sameAuthor = entries.filter((x) => x.id !== e.id && x.author && x.author === e.author);
    const sharedTag = entries.filter((x) => x.id !== e.id && (x.tags || []).some((t) => (e.tags || []).includes(t)));
    const related = [...sameAuthor, ...sharedTag.filter((x) => !sameAuthor.includes(x))].slice(0, 3);
    const desc = e.description
      || `${e.name || e.id} —— ${e.author || '匿名'}投稿的开机动画${e.width ? `，${e.width}×${e.height}` : ''}${e.duration ? `，${Number(e.duration).toFixed(1)} 秒` : ''}。`;
    track(rel, page({
      depth: 3, rel, current: 'animations/',
      head: {
        title: e.name || e.id,
        description: desc,
        ogType: 'video.other',
        ogImage: e.preview || '',
        jsonLd: {
          '@context': 'https://schema.org',
          '@type': 'CreativeWork',
          name: e.name || e.id,
          description: desc,
          creator: e.author ? { '@type': 'Person', name: e.author } : undefined,
          license: e.license || undefined,
          datePublished: e.submitted || undefined,
          encodingFormat: 'video/mp4',
          contentUrl: e.video || undefined,
          thumbnailUrl: e.preview || undefined,
          url: new URL(rel.replace(/index\.html$/, ''), SITE.baseUrl).href,
        },
      },
      body: detailPage(e, related, '../../', 3),
      bodyAttrs: { 'data-page': 'detail', 'data-animation-id': e.id },
    }));
  }

  /* 作者 */
  const byAuthor = new Map();
  for (const e of entries) {
    if (!e.author) continue;
    if (!byAuthor.has(e.author)) byAuthor.set(e.author, []);
    byAuthor.get(e.author).push(e);
  }

  track('creators/index.html', page({
    depth: 2, rel: 'creators/index.html', current: 'creators/',
    head: {
      title: '作者',
      description: `社区动画的作者们，共 ${byAuthor.size} 位。`,
    },
    body: creatorsPage('../'),
    bodyAttrs: { 'data-page': 'creators' },
  }));

  for (const [author, list] of byAuthor) {
    const rel = `creators/${author}/index.html`;
    track(rel, page({
      depth: 3, rel, current: 'creators/',
      head: {
        title: author,
        description: `${author} 投稿的 ${list.length} 个开机动画。`,
        ogImage: list.find((x) => x.preview)?.preview || '',
        jsonLd: {
          '@context': 'https://schema.org', '@type': 'CollectionPage',
          name: `${author} 的动画`, url: new URL(rel.replace(/index\.html$/, ''), SITE.baseUrl).href,
        },
      },
      body: creatorPage(author, list, '../../'),
      bodyAttrs: { 'data-page': 'creator', 'data-creator': author },
    }));
  }

  /* 社区 / 下载 / 关于 / 更新日志 */
  track('community/index.html', page({
    depth: 2, rel: 'community/index.html', current: 'community/',
    head: { title: '社区', description: '最新上架的社区动画、作者，以及完整的投稿流程说明。' },
    body: communityPage(entries, '../'),
    bodyAttrs: { 'data-page': 'community' },
  }));
  track('download/index.html', page({
    depth: 2, rel: 'download/index.html', current: 'download/',
    head: {
      title: '下载',
      description: '下载开机动画（Windows 10 / 11）。不需要管理员权限，不需要安装 .NET 运行时。',
      jsonLd: {
        '@context': 'https://schema.org', '@type': 'SoftwareApplication',
        name: 'Boot Animation 开机动画',
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Windows 10, Windows 11',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
        url: new URL('download/', SITE.baseUrl).href,
        softwareHelp: new URL('docs/', SITE.baseUrl).href,
      },
    },
    body: downloadPage('../'),
    bodyAttrs: { 'data-page': 'download' },
  }));
  track('about/index.html', page({
    depth: 2, rel: 'about/index.html', current: 'about/',
    head: { title: '关于', description: '项目定位、零服务器架构、数据模型与许可说明。' },
    body: aboutPage('../'),
  }));
  track('changelog/index.html', page({
    depth: 2, rel: 'changelog/index.html', current: 'changelog/',
    head: { title: '更新日志', description: '软件 Releases 与网站/目录的更新入口。' },
    body: changelogPage('../'),
  }));

  /* 文档 */
  if (docs.length) {
    track('docs/index.html', page({
      depth: 2, rel: 'docs/index.html', current: 'docs/',
      head: {
        title: '文档', description: '安装、卸载、导入社区动画、自己制作、排错与恢复。',
        jsonLd: {
          '@context': 'https://schema.org', '@type': 'CollectionPage',
          name: '文档', url: new URL('docs/', SITE.baseUrl).href,
        },
      },
      body: docsIndexPage(docs, groups, '../'),
    }));
    for (const doc of docs) {
      const rel = `docs/${doc.slug}/index.html`;
      track(rel, page({
        depth: 3, rel, current: 'docs/',
        head: {
          title: doc.title,
          description: doc.summary || `${doc.title} —— 开机动画文档。`,
          jsonLd: {
            '@context': 'https://schema.org', '@type': 'TechArticle',
            headline: doc.title, description: doc.summary || '',
            url: new URL(rel.replace(/index\.html$/, ''), SITE.baseUrl).href,
            inLanguage: 'zh-CN',
          },
        },
        body: docPage(doc, docs, groups, '../../'),
      }));
    }
  }

  /* 404（GitHub Pages 会自动用它兜住未知路径）。
     注意：它可能被任意深度的 URL 触发，所以相对链接不可靠 —— 用 <base> 钉住站点根。 */
  track('404.html', page({
    depth: 1, rel: '404.html',
    head: {
      title: '页面不存在',
      description: '这个地址没有对应页面。',
      robots: 'noindex',
      base: SITE.baseUrl,
    },
    body: notFoundPage('./'),
  }));

  /* 搜索索引：文档 + 静态页（动画部分由运行时从仓储取） */
  const siteIndex = {
    generatedAt: new Date().toISOString(),
    pages: [
      ...docs.map((d) => ({
        kind: 'doc', id: d.slug, title: d.title, subtitle: d.summary || '文档',
        href: `docs/${d.slug}/`, keywords: `${d.slug} ${d.title} ${d.summary || ''} 文档 docs`.toLowerCase(),
      })),
      { kind: 'page', id: 'download', title: '下载开机动画', subtitle: 'Windows 10 / 11', href: 'download/', keywords: '下载 download 安装 windows 软件' },
      { kind: 'page', id: 'animations', title: '动画库', subtitle: '浏览社区动画', href: 'animations/', keywords: '动画库 animations 浏览 社区' },
      { kind: 'page', id: 'community', title: '社区与投稿', subtitle: '投稿流程与作者', href: 'community/', keywords: '社区 投稿 submit 作者 creator' },
      { kind: 'page', id: 'creators', title: '作者', subtitle: '社区作者列表', href: 'creators/', keywords: '作者 creators 上传者' },
      { kind: 'page', id: 'about', title: '关于', subtitle: '项目与架构', href: 'about/', keywords: '关于 about 架构 许可' },
      { kind: 'page', id: 'changelog', title: '更新日志', subtitle: '版本与提交', href: 'changelog/', keywords: '更新日志 changelog release' },
    ],
  };
  write('assets/data/site-index.json', JSON.stringify(siteIndex, null, 2));
  written.push('assets/data/site-index.json');

  /* sitemap */
  const urls = written.filter((w) => w.endsWith('.html') && w !== '404.html');
  const today = new Date().toISOString().slice(0, 10);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => {
    const loc = new URL(u.replace(/index\.html$/, ''), SITE.baseUrl).href;
    const entry = entries.find((e) => u === `animations/${e.id}/index.html`);
    const lastmod = entry && entry.submitted ? String(entry.submitted) : today;
    const priority = u === 'index.html' ? '1.0' : entry ? '0.7' : '0.6';
    return `  <url><loc>${esc(loc)}</loc><lastmod>${lastmod}</lastmod><priority>${priority}</priority></url>`;
  }).join('\n')}
</urlset>
`;
  write('sitemap.xml', sitemap);
  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', SITE.baseUrl).href}\n`);
  written.push('sitemap.xml', 'robots.txt');

  /* favicon（内联 SVG，零依赖） */
  write('assets/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="8" fill="#0a0b0d"/>
<rect x="6" y="9" width="20" height="14" rx="2.5" fill="none" stroke="#e11d2e" stroke-width="2"/>
<path d="M13.5 13.5v5l4.6-2.5z" fill="#e11d2e"/>
</svg>
`);

  console.log(`[build-site] 写出 ${written.length} 个文件到 docs/`);
  return written.length;
}

main().then((n) => {
  console.log(`[build-site] 完成（${n}）`);
}).catch((error) => {
  console.error('[build-site] 失败：', error);
  process.exitCode = 1;
});
