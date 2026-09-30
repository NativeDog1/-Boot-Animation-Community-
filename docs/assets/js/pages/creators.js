/**
 * creators.js — 作者列表。
 *
 * 没有账号系统：作者就是条目里的一个字符串，所以这里**只聚合展示**，
 * 不假装有头像、关注数、认证标识这些东西。
 */
import { $, el, clear, stateBlock } from '../ui/dom.js';
import { creatorCard } from '../ui/card.js';
import { creatorsOf } from '../catalog.js';
import { rootPath } from '../config.js';

export async function init({ repo }) {
  const host = $('#ba-main');
  if (!host) return;

  let entries = [];
  try {
    entries = await repo.getAnimations();
  } catch (error) {
    host.replaceChildren(stateBlock({
      kind: 'error',
      title: '目录取不到',
      text: `${error?.message || error}。作者是从动画条目里聚合出来的，所以目录拿不到时这里也没内容。`,
      action: el('a', { class: 'btn', href: rootPath('animations/'), text: '去动画库' }),
    }));
    return;
  }

  const creators = creatorsOf(entries);
  clear(host);

  if (!creators.length) {
    host.append(stateBlock({
      kind: 'empty',
      title: '还没有作者',
      text: '目录靠投稿长起来 —— 第一条上架之后，这里就会出现作者名。',
      action: (() => {
        const b = el('button', { class: 'btn btn--primary', type: 'button', text: '我要投稿', 'data-open-wizard': '' });
        return b;
      })(),
    }));
    return;
  }

  host.append(el('p', { class: 'muted small', style: 'margin-bottom:var(--s-5)', text: `${creators.length} 位作者 · 共 ${entries.length} 个动画。作者名来自条目里的 author 字段，没有账号体系。` }));

  const grid = el('div', { class: 'grid' });
  for (const c of creators) grid.append(creatorCard(c));
  host.append(grid);

  document.body.dataset.ready = 'true';
}
