/**
 * app.js — 站点入口。
 *
 * 职责只有四件：装好全站外壳（导航/搜索/向导）、按 `body[data-page]` **按需动态加载**
 * 那一页的模块（这就是代码拆分：首页不会下载动画库的代码）、兜住任何未捕获错误，
 * 让用户看到一句人话而不是白屏。
 *
 * 页面模块约定：`export async function init({ repo })`。
 */
import { ready, el, $, icon, toast } from './ui/dom.js';
import { buildMobileNav, initMobileNav, initHeaderScroll, markActiveNav, NAV_ITEMS } from './ui/nav.js';
import { initSearch } from './ui/search.js';
import { openWizard } from './ui/submit-wizard.js';
import { getRepository } from './repository.js';

/** 页面名 → 模块（动态 import = 真正的代码拆分）。 */
const PAGES = {
  home: () => import('./pages/home.js'),
  animations: () => import('./pages/animations.js'),
  detail: () => import('./pages/detail.js'),
  creators: () => import('./pages/creators.js'),
  creator: () => import('./pages/creator.js'),
  download: () => import('./pages/download.js'),
  community: () => import('./pages/community.js'),
};

/** 把页面级错误画成一个可读的状态块，别留白屏。 */
function renderFatal(target, title, detail, extra) {
  if (!target) return;
  target.replaceChildren();
  const box = el('div', { class: 'state state--error' });
  const ic = icon('danger', 34, 'state__icon');
  if (ic) box.append(ic);
  box.append(el('h3', { class: 'state__title', text: title }));
  box.append(el('p', { class: 'state__text', text: detail }));
  if (extra) box.append(extra);
  const actions = el('div', { class: 'btn-row' });
  const retry = el('button', { class: 'btn', type: 'button', text: '重试' });
  retry.addEventListener('click', () => location.reload());
  actions.append(retry);
  actions.append(el('a', { class: 'btn btn--ghost', href: './', text: '回首页' }));
  box.append(actions);
  target.append(box);
}

ready(async () => {
  const main = $('#ba-main');
  const page = (document.body.dataset.page || 'static').trim();

  /* ── 全站外壳 ── */
  try {
    buildMobileNav();
    initMobileNav();
    initHeaderScroll();
    markActiveNav();
  } catch (error) {
    console.warn('[ba] 外壳初始化失败', error);
  }

  // 任何带 data-open-wizard 的按钮都能开向导（首页、社区页、空态都用它）
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-open-wizard]');
    if (!trigger) return;
    event.preventDefault();
    try { openWizard(); } catch (error) { toast('向导打不开：' + (error?.message || error), 'err'); }
  });

  // 搜索：数据要联网，绝不能阻塞页面渲染
  initSearch().catch((error) => {
    console.warn('[ba] 搜索索引初始化失败（不影响页面）', error);
  });

  /* ── 页面 ── */
  // 纯静态页（文档 / 关于 / 更新日志 / 404）：生成器已经写好全部内容，
  // 这里只做外壳增强（导航、搜索、向导），绝不动 #ba-main。
  if (page === 'static') return;

  const load = PAGES[page];
  if (!load) {
    // 生成器还没认过的页面：如实说明，而不是留空
    renderFatal(main, '这个页面还没接上', `body[data-page] = "${page}" 没有对应的页面模块。`);
    return;
  }

  try {
    const mod = await load();
    if (typeof mod.init !== 'function') throw new Error(`${page} 模块没有导出 init()`);
    await mod.init({ repo: getRepository() });
  } catch (error) {
    console.error('[ba] 页面初始化失败', error);
    renderFatal(
      main,
      '这一页加载失败了',
      `原因：${error?.message || error}。目录数据来自 GitHub，网络不通时也可能这样 —— 点重试或稍后再来。`,
    );
  }
});

/* ── 兜底：脚本层面的意外也要有交代 ── */
window.addEventListener('unhandledrejection', (event) => {
  console.error('[ba] 未处理的 Promise 拒绝', event.reason);
  const main = $('#ba-main');
  if (main && main.childElementCount === 0) {
    renderFatal(main, '页面没能加载完', String(event.reason?.message || event.reason || '未知错误'));
  }
});

window.addEventListener('error', (event) => {
  if (!event || !event.message) return;
  console.error('[ba] 运行期错误', event.message);
});

export { NAV_ITEMS, renderFatal };
