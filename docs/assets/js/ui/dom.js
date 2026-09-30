/**
 * dom.js — 极小的 DOM 助手 + 图标 + 状态块 + toast + 元信息。
 *
 * 刻意不引任何框架：这个站点的交互量不值得一个运行时。规则只有一条 ——
 * **一律用 textContent / createElement，不用 innerHTML 拼数据**，
 * 因为目录内容来自外部投稿，XSS 的代价比省几行代码高得多。
 */

/** 创建元素：el('div', {class:'x'}, ['文本', childEl]) */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'html') node.innerHTML = String(v); // 仅用于本仓库自带的受信图标
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** 只读的「已就绪」回调。 */
export function ready(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else fn();
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/* ───────────────────────────── 图标（内联，零请求） ───────────────────────────── */

const ICONS = {
  play: '<path d="M8 5v14l11-7z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 20h16"/>',
  windows: '<path d="M3 5.5l7.5-1v7H3zM12.5 4.2L21 3v8.5h-8.5zM3 12.5h7.5v7L3 18.5zM12.5 12.5H21V21l-8.5-1.2z"/>',
  github: '<path d="M12 2a10 10 0 00-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.1-1.47-1.1-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.9.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 015 0c1.9-1.29 2.74-1.02 2.74-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0012 2z"/>',
  tag: '<path d="M3 12l9-9 9 9-9 9z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  warn: '<path d="M12 3l9 17H3z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  danger: '<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/>',
  offline: '<path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 017 0"/><path d="M5 12.5a10 10 0 013-1.9"/><path d="M16 10.6a10 10 0 013 1.9"/><path d="M12 20h.01"/>',
  empty: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l4-4 4 3 3-3 7 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  shuffle: '<path d="M4 7h4l8 10h4"/><path d="M16 4l4 3-4 3"/><path d="M16 14l4 3-4 3"/><path d="M4 17h4"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',
};

/** 返回一个 <svg> 节点。`name` 不存在时返回 null，不抛。 */
export function icon(name, size = 18, extraClass = '') {
  const path = ICONS[name];
  if (!path) return null;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (extraClass) svg.setAttribute('class', extraClass);
  svg.innerHTML = path; // 受信常量，非用户数据
  return svg;
}

/* ───────────────────────────── 状态块 ───────────────────────────── */

/**
 * 统一的状态呈现：loading / empty / error / offline 都走这里，
 * 保证 **任何页面都不会出现白屏或裸 JS 报错**。
 * @param {{kind:'loading'|'empty'|'error'|'offline', title?:string, text?:string,
 *          action?:HTMLElement|null}} opts
 */
export function stateBlock(opts) {
  const kind = opts.kind || 'empty';
  const icons = { loading: 'clock', empty: 'empty', error: 'danger', offline: 'offline' };
  const wrap = el('div', { class: `state state--${kind}`, role: kind === 'error' ? 'alert' : 'status' });
  const ic = icon(icons[kind] || 'info', 34, 'state__icon');
  if (ic) wrap.append(ic);
  if (opts.title) wrap.append(el('h3', { class: 'state__title', text: opts.title }));
  if (opts.text) wrap.append(el('p', { class: 'state__text', text: opts.text }));
  if (opts.action) wrap.append(opts.action);
  return wrap;
}

/** 目录加载中的骨架屏（数量按可视宽度粗估，不求精确）。 */
export function skeletonGrid(count = 6) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i += 1) {
    frag.append(
      el('div', { class: 'skeleton', 'aria-hidden': 'true' }, [
        el('div', { class: 'skeleton__thumb sk-anim' }),
        el('div', { class: 'skeleton__line sk-anim' }),
        el('div', { class: 'skeleton__line skeleton__line--short sk-anim' }),
      ]),
    );
  }
  return frag;
}

/* ───────────────────────────── toast ───────────────────────────── */

let toastTimer = null;
/** 全局提示条。kind: '' | 'ok' | 'err'。 */
export function toast(message, kind = '') {
  let node = document.getElementById('ba-toast');
  if (!node) {
    node = el('div', { id: 'ba-toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(node);
  }
  node.textContent = String(message);
  node.dataset.kind = kind;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, 3200);
}

/* ───────────────────────────── 文档元信息 ───────────────────────────── */

/** 客户端渲染的页面上更新标题与描述（静态页由生成器直接写进 HTML）。 */
export function setDocumentMeta({ title, description } = {}) {
  if (title) document.title = title;
  if (description) {
    let m = document.querySelector('meta[name="description"]');
    if (!m) {
      m = el('meta', { name: 'description' });
      document.head.append(m);
    }
    m.setAttribute('content', description);
  }
}

/** 复制到剪贴板，带降级。返回是否成功。 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    try {
      const ta = el('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = String(text);
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** 防抖。 */
export function debounce(fn, ms = 160) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
