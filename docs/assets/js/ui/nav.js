/**
 * nav.js — 顶栏与移动端菜单。
 *
 * 移动端**不是把桌面导航缩小**：断点切换时桌面 nav 整个隐藏，改用全屏面板，
 * 并且面板里带主 CTA（下载软件）与搜索入口 —— 手机上最想干的两件事都在第一屏。
 */
import { $, $$, el, icon } from './dom.js';
import { rootPath } from '../config.js';

/** 依 location.pathname 高亮当前栏目。用前缀匹配（/docs/xxx 属于 /docs/）。 */
export function markActiveNav() {
  const here = location.pathname.replace(/\/+$/, '/');
  for (const link of $$('.nav__link, .mobile-nav__link')) {
    const href = link.getAttribute('href') || '';
    if (!href || href.startsWith('http') || href.startsWith('#')) continue;
    let target;
    try {
      target = new URL(href, location.href).pathname.replace(/\/+$/, '/');
    } catch {
      continue;
    }
    const isHome = target.endsWith('/') && (target === '/' || target.split('/').filter(Boolean).length === 1);
    const match = isHome ? here === target : here === target || here.startsWith(target);
    if (match) link.setAttribute('aria-current', 'page');
  }
}

export function initMobileNav() {
  const burger = $('#ba-burger');
  const panel = $('#ba-mobile-nav');
  if (!burger || !panel) return;

  const setOpen = (open) => {
    panel.dataset.open = open ? 'true' : 'false';
    panel.hidden = !open;
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      const first = panel.querySelector('a, button');
      if (first) first.focus({ preventScroll: true });
    }
  };

  setOpen(false);
  burger.addEventListener('click', () => setOpen(panel.dataset.open !== 'true'));
  panel.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.dataset.open === 'true') {
      setOpen(false);
      burger.focus();
    }
  });
  // 视口变宽就收起面板，避免留下一个盖住页面的半透明层
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900 && panel.dataset.open === 'true') setOpen(false);
  });
}

/** 顶栏的滚动状态：滚下去给一点阴影，让内容与导航分得开。 */
export function initHeaderScroll() {
  const header = $('.site-header');
  if (!header) return;
  let last = -1;
  const onScroll = () => {
    const scrolled = window.scrollY > 8 ? 1 : 0;
    if (scrolled !== last) {
      last = scrolled;
      header.style.boxShadow = scrolled ? 'var(--sh-2)' : 'none';
    }
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
}

/** 页脚显示当前数据源与状态（排错用；也让「零服务器」这件事可见）。 */
export function setSourceLabel(text) {
  const node = $('#ba-source');
  if (node) node.textContent = text || '';
}

/* ── 由 JS 生成移动端面板与搜索按钮所需的节点（页面里只写骨架，避免每页重复） ── */

export const NAV_ITEMS = [
  { href: 'animations/', label: '动画库', sub: '浏览与预览社区动画' },
  { href: 'community/', label: '社区', sub: '最新上架、作者、投稿' },
  { href: 'download/', label: '下载软件', sub: 'Windows 10 / 11 · 免安装依赖' },
  { href: 'docs/', label: '文档', sub: '安装、导入、排错、恢复' },
];

/** 生成移动端面板内容（每页共用同一份定义）。 */
export function buildMobileNav() {
  const panel = $('#ba-mobile-nav');
  if (!panel || panel.dataset.built === 'true') return panel;
  panel.dataset.built = 'true';

  for (const item of NAV_ITEMS) {
    panel.append(
      el('a', { class: 'mobile-nav__link', href: rootPath(item.href) }, [
        el('span', { text: item.label }),
        el('small', { text: item.sub }),
      ]),
    );
  }

  const cta = el('div', { class: 'mobile-nav__cta stack' });
  const dl = el('a', { class: 'btn btn--primary btn--lg btn--block', href: rootPath('download/') });
  const ic = icon('windows', 16, 'btn__icon');
  if (ic) dl.append(ic);
  dl.append(document.createTextNode('下载软件'));
  cta.append(dl);
  cta.append(el('a', { class: 'btn btn--block', href: rootPath('animations/'), text: '浏览动画库' }));
  panel.append(cta);

  return panel;
}
