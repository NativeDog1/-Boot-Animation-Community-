/**
 * search.js — 全局搜索 / 命令面板（Ctrl+K）。
 *
 * 没有后端，所以索引在客户端：动画来自仓储（GitHubStaticRepository），
 * 文档与静态页来自生成器产出的 `assets/data/site-index.json`（同源，离线也在）。
 *
 * 键盘契约（照惯例，别自创）：
 *   Ctrl/⌘ + K 打开 · Esc 关闭 · ↑↓ 选择 · Enter 打开 · Tab 不困在面板里
 */
import { $, el, icon, debounce } from './dom.js';
import { rootUrl } from '../config.js';
import { buildSearchIndex, searchIndex } from '../catalog.js';
import { getRepository } from '../repository.js';
import { markActiveNav } from './nav.js';

let built = false;
let dialog = null;
let input = null;
let listNode = null;
let items = [];
let filtered = [];
let cursor = 0;

function open() {
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
  input.value = '';
  render('');
  input.focus({ preventScroll: true });
}

function close() {
  if (dialog && dialog.open) dialog.close();
}

/** 打开当前高亮项。 */
function go(index = cursor) {
  const item = filtered[index];
  if (!item) return;
  close();
  const href = item.href || '';
  if (/^https?:/.test(href)) window.open(href, '_blank', 'noopener');
  else location.href = href;
}

function render(query) {
  filtered = searchIndex(items, query, 40);
  cursor = 0;
  listNode.replaceChildren();
  if (!filtered.length) {
    listNode.append(
      el('li', {}, [
        el('div', { class: 'state', style: 'border:0;background:none;padding:var(--s-5)' }, [
          el('p', { class: 'state__text', text: query ? `没有匹配「${query}」的动画、作者、标签或文档` : '输入关键词开始搜索' }),
        ]),
      ]),
    );
    return;
  }
  filtered.forEach((item, i) => {
    const btn = el('button', {
      class: 'palette__item',
      type: 'button',
      role: 'option',
      'aria-selected': i === 0 ? 'true' : 'false',
      onclick: () => go(i),
      onmousemove: () => setCursor(i),
    });
    if (item.thumb) {
      const img = el('img', { src: item.thumb, alt: '', loading: 'lazy' });
      img.addEventListener('error', () => img.remove());
      btn.append(img);
    } else {
      const kindIcon = { doc: 'doc', page: 'arrow', creator: 'user', tag: 'tag', animation: 'play' }[item.kind] || 'info';
      const box = el('span', { class: 'palette__ic' });
      const ic = icon(kindIcon, 16);
      if (ic) box.append(ic);
      btn.append(box);
    }
    btn.append(
      el('span', { class: 'palette__main' }, [
        el('span', { class: 'palette__name', text: item.title }),
        item.subtitle ? el('span', { class: 'palette__sub', text: item.subtitle }) : null,
      ]),
    );
    btn.append(el('span', { class: 'palette__kind', text: { animation: '动画', creator: '作者', tag: '标签', doc: '文档', page: '页面' }[item.kind] || '' }));
    listNode.append(el('li', {}, [btn]));
  });
}

function setCursor(next) {
  const rows = [...listNode.querySelectorAll('.palette__item')];
  if (!rows.length) return;
  cursor = (next + rows.length) % rows.length;
  rows.forEach((r, i) => r.setAttribute('aria-selected', i === cursor ? 'true' : 'false'));
  rows[cursor].scrollIntoView({ block: 'nearest' });
}

/**
 * @param {{repo?: import('../repository.js').AnimationRepository}} [opts]
 */
export async function initSearch(opts = {}) {
  const trigger = $('#ba-search');
  if (!trigger || built) return;
  built = true;

  dialog = el('dialog', { class: 'palette', id: 'ba-palette', 'aria-label': '站内搜索' });
  input = el('input', {
    class: 'palette__input',
    type: 'text',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'ba-palette-list',
    'aria-autocomplete': 'list',
    placeholder: '搜索动画、作者、标签、文档…',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  listNode = el('ul', { class: 'palette__list', id: 'ba-palette-list', role: 'listbox', 'aria-label': '搜索结果' });
  dialog.append(
    input,
    listNode,
    el('div', { class: 'palette__foot' }, [
      el('span', {}, [el('kbd', { text: '↑' }), el('kbd', { text: '↓' }), document.createTextNode(' 选择')]),
      el('span', {}, [el('kbd', { text: 'Enter' }), document.createTextNode(' 打开')]),
      el('span', {}, [el('kbd', { text: 'Esc' }), document.createTextNode(' 关闭')]),
    ]),
  );
  document.body.append(dialog);

  input.addEventListener('input', debounce(() => render(input.value), 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(cursor + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(cursor - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(); }
    else if (e.key === 'Home') { e.preventDefault(); setCursor(0); }
    else if (e.key === 'End') { e.preventDefault(); setCursor(filtered.length - 1); }
  });
  // 点面板外面关掉
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.addEventListener('close', () => { if (trigger) trigger.focus({ preventScroll: true }); });

  trigger.addEventListener('click', open);
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); open(); return; }
    // 「/」快速搜索（输入框里不劫持）
    if (k === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) {
      e.preventDefault();
      open();
    }
  });

  // 索引：静态页 + 文档（同源）+ 动画（仓储）
  const extra = [];
  try {
    const r = await fetch(rootUrl('assets/data/site-index.json'), { cache: 'force-cache' });
    if (r.ok) {
      const data = await r.json();
      for (const p of data.pages || []) extra.push(p);
    }
  } catch { /* 索引拿不到就只搜动画 */ }

  try {
    const repo = opts.repo || getRepository();
    const entries = await repo.getAnimations();
    items = [...extra, ...buildSearchIndex(entries).filter((x) => !x.nsfw)];
  } catch {
    items = extra;
  }

  markActiveNav();
  return { open, close };
}
