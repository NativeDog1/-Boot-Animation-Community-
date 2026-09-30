/**
 * creator.js — 单个作者的页面。作者 id 来自生成器写进 body[data-creator] 的值。
 */
import { $, el, clear, stateBlock } from '../ui/dom.js';
import { animationCard } from '../ui/card.js';
import { creatorsOf, filterEntries, entryPath } from '../catalog.js';
import { rootPath } from '../config.js';

export async function init({ repo }) {
  const host = $('#ba-main');
  if (!host) return;
  const id = (document.body.dataset.creator || '').trim();

  let entries = [];
  try {
    entries = await repo.getAnimations();
  } catch (error) {
    host.replaceChildren(stateBlock({
      kind: 'error', title: '目录取不到', text: String(error?.message || error),
      action: el('a', { class: 'btn', href: rootPath('creators/'), text: '回作者列表' }),
    }));
    return;
  }

  const creator = creatorsOf(entries).find((c) => String(c.id) === id);
  if (!creator) {
    host.replaceChildren(stateBlock({
      kind: 'empty',
      title: '找不到这位作者',
      text: `「${id || '(空)'}」在目录里没有动画。可能是名字写错了，或者他的条目都被下架了。`,
      action: el('a', { class: 'btn', href: rootPath('creators/'), text: '回作者列表' }),
    }));
    return;
  }

  // 补一个真实可点的 GitHub 链接：只有作者名长得像用户名时才给（不猜、不拼错就装懂）
  const looksLikeUser = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37})$/.test(creator.id);
  const heading = $('#ba-creator-head');
  if (heading) {
    clear(heading);
    heading.append(el('h1', { text: creator.name }));
    const meta = [`${creator.count} 个动画`];
    if (creator.latest) meta.push(`最近上架 ${creator.latest}`);
    heading.append(el('p', { class: 'muted', text: meta.join(' · ') }));
    if (looksLikeUser) {
      heading.append(el('div', { class: 'btn-row' }, [
        el('a', { class: 'btn btn--sm', href: `https://github.com/${creator.id}`, target: '_blank', rel: 'noopener', text: `github.com/${creator.id}` }),
      ]));
    }
  }

  const grid = el('div', { class: 'grid' });
  for (const e of filterEntries(creator.entries, { sort: 'newest' })) {
    grid.append(animationCard(e));
  }
  const listHost = $('#ba-creator-list');
  if (listHost) listHost.replaceChildren(grid);

  document.body.dataset.ready = 'true';
  return { creator };
}

export { entryPath };
