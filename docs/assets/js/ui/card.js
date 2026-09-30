/**
 * card.js — 动画卡片与作者卡片。**目录里所有的卡片都从这里出**，
 * 所以顺序、徽章、空字段的处理在全站是一致的。
 *
 * 两条规则：
 *   1. 字段缺了就**不渲染那一项**，不写「未知」占位、更不编造数字（下载量我们没有就不显示）。
 *   2. 缩略图一定是图片；只有桌面端悬停才可能加载视频（见 video.js/hoverPreview）。
 */
import { el, icon, prefersReducedMotion } from './dom.js';
import {
  formatBytes, formatDuration, resolutionLabel, entryPath, creatorPath, isNew, RESOLUTION_LABELS, resolutionBucket,
} from '../catalog.js';
import { rootPath } from '../config.js';
import { hoverPreview } from './video.js';

function thumbNode(entry, { priority = false } = {}) {
  const box = el('div', { class: 'card__thumb' });
  const src = entry.preview || '';
  if (src) {
    const img = el('img', {
      src,
      alt: '',
      loading: priority ? 'eager' : 'lazy',
      decoding: 'async',
    });
    if (priority) img.setAttribute('fetchpriority', 'high');
    img.addEventListener('error', () => {
      img.remove();
      box.append(fallbackThumb(entry));
    });
    box.append(img);
  } else {
    box.append(fallbackThumb(entry));
  }

  // 角标：只放真实存在的信息
  const top = el('div', { class: 'card__badges card__badges--top' });
  if (entry.nsfw) top.append(el('span', { class: 'badge badge--nsfw', text: '不适宜内容' }));
  if (isNew(entry)) top.append(el('span', { class: 'badge badge--new', text: '新上架' }));
  const bottom = el('div', { class: 'card__badges' });
  const res = resolutionLabel(entry);
  if (res !== '—') bottom.append(el('span', { class: 'badge badge--res', text: res }));
  if (entry.duration) bottom.append(el('span', { class: 'badge badge--dur', text: formatDuration(entry.duration) }));
  if (top.childNodes.length) box.append(top);
  if (bottom.childNodes.length) box.append(bottom);

  // 悬停预览：只有桌面 + 未开启 reduced-motion + 有直链才启用
  if (entry.video && !prefersReducedMotion()) {
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (!coarse) hoverPreview(box, { src: entry.video, disabled: false });
  }
  return box;
}

/** 预览图挂了 / 作者没给：给一块有交代的占位，不留白。 */
function fallbackThumb(entry) {
  const box = el('div', { class: 'thumb-fallback' });
  const ic = icon('empty', 26);
  if (ic) box.append(ic);
  box.append(el('span', { text: entry.preview ? '预览图加载失败' : '作者没有提供预览图' }));
  return box;
}

/**
 * @param {object} entry 目录条目
 * @param {{priority?: boolean}} [opts] priority=true 时缩略图立刻加载（首屏前几张）
 */
export function animationCard(entry, opts = {}) {
  const a = el('a', {
    class: 'card card--link',
    href: rootPath(entryPath(entry.id)),
    'aria-label': `${entry.name}${entry.author ? ' — ' + entry.author : ''}`,
  });
  a.append(thumbNode(entry, opts));

  const body = el('div', { class: 'card__body' });
  body.append(el('h3', { class: 'card__title', text: entry.name || entry.id }));

  const meta = [];
  if (entry.author) meta.push(entry.author);
  if (entry.bytes) meta.push(formatBytes(entry.bytes));
  if (entry.fps) meta.push(`${entry.fps} fps`);
  if (meta.length) body.append(el('p', { class: 'card__meta', text: meta.join(' · ') }));

  if (entry.description) body.append(el('p', { class: 'card__desc', text: entry.description }));

  const tags = (entry.tags || []).slice(0, 3);
  if (tags.length) {
    const row = el('div', { class: 'card__tags' });
    for (const t of tags) row.append(el('span', { class: 'tag', text: t }));
    body.append(row);
  }

  const foot = el('div', { class: 'card__foot' });
  foot.append(el('span', { class: 'muted small', text: entry.submitted || '' }));
  body.append(foot);

  a.append(body);
  return a;
}

/** 作者卡片（作者不是账号，就是一个字符串 + 聚合出的条目数）。 */
export function creatorCard(creator) {
  const a = el('a', { class: 'card card--link', href: rootPath(creatorPath(creator.id)) });
  const body = el('div', { class: 'card__body' });
  body.append(el('h3', { class: 'card__title', text: creator.name }));
  body.append(el('p', { class: 'card__meta', text: `${creator.count} 个动画${creator.latest ? ' · 最近 ' + creator.latest : ''}` }));

  const row = el('div', { class: 'card__tags' });
  const covers = creator.entries.slice(0, 3).filter((e) => e.preview);
  for (const e of covers) {
    row.append(el('img', {
      src: e.preview, alt: '', loading: 'lazy', decoding: 'async',
      style: 'width:56px;height:32px;object-fit:cover;border-radius:6px;border:1px solid var(--line)',
    }));
  }
  if (row.childNodes.length) body.append(row);
  a.append(body);
  return a;
}

/** 空态（目录真的没有内容时）—— 不编造推荐位。 */
export function emptyCatalogState(onSubmit) {
  const wrap = el('div', { class: 'state' });
  const ic = icon('empty', 34, 'state__icon');
  if (ic) wrap.append(ic);
  wrap.append(el('h3', { class: 'state__title', text: '目录里还没有动画' }));
  wrap.append(el('p', {
    class: 'state__text',
    text: '这个目录完全靠投稿长起来 —— 第一条由你来也行。投稿走 GitHub Issue 表单，机器人会自动算好哈希和预览图。',
  }));
  if (onSubmit) {
    const btn = el('button', { class: 'btn btn--primary', type: 'button', text: '我要投第一个' });
    btn.addEventListener('click', onSubmit);
    wrap.append(btn);
  }
  return wrap;
}

/** 分辨率归档的标签（筛选条用）。 */
export function resolutionChipLabel(bucket) {
  return RESOLUTION_LABELS[bucket] || resolutionBucket({});
}
