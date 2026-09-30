/**
 * home.js — 首页。
 *
 * 3 秒内必须说清两件事：**这是什么软件** 以及 **它有一个社区动画库**。
 * 所有数字都来自真实目录（几个动画、几位作者），没有真实数据就一个数字都不写。
 */
import { $, el, icon, stateBlock, skeletonGrid, clear } from '../ui/dom.js';
import { animationCard } from '../ui/card.js';
import { filterEntries, creatorsOf, SORTS } from '../catalog.js';
import { rootPath, SOFTWARE } from '../config.js';

export async function init({ repo }) {
  const featuredHost = $('#ba-home-featured');
  const statsHost = $('#ba-home-stats');
  const statusHost = $('#ba-home-status');

  let entries = [];
  let failed = null;
  try {
    entries = await repo.getAnimations();
  } catch (error) {
    failed = error;
  }

  /* ── 真实统计（没有就留空，不编） ── */
  if (statsHost) {
    clear(statsHost);
    if (!failed) {
      const creators = creatorsOf(entries);
      const facts = [
        ['动画', String(entries.length)],
        ['作者', String(creators.length)],
      ];
      const latest = filterEntries(entries, { sort: 'newest' })[0];
      if (latest && latest.submitted) facts.push(['最近上架', latest.submitted]);
      for (const [label, value] of facts) {
        statsHost.append(
          el('div', { class: 'hero__fact' }, [
            el('b', { text: value }),
            el('span', { text: label }),
          ]),
        );
      }
    }
  }
  if (statusHost) {
    statusHost.textContent = failed
      ? '目录暂时取不到 —— 下面的内容可能不完整'
      : repo.status === 'stale'
        ? '当前显示的是离线缓存目录'
        : '';
  }

  /* ── 最新上架（首页不叫"精选"：没有编辑推荐就不假装有） ── */
  if (featuredHost) {
    clear(featuredHost);
    if (failed) {
      featuredHost.append(stateBlock({
        kind: 'offline',
        title: '目录取不到',
        text: `${failed.message || failed}。动画库托管在 GitHub 上，网络不通时就这样。`,
        action: el('a', { class: 'btn', href: rootPath('animations/'), text: '去动画库再试' }),
      }));
      return;
    }
    if (!entries.length) {
      featuredHost.append(stateBlock({
        kind: 'empty',
        title: '目录里还没有动画',
        text: '这个库完全靠投稿长起来。你手上那段片头，可以是第一条。',
        action: (() => {
          const b = el('button', { class: 'btn btn--primary', type: 'button', text: '我要投稿', 'data-open-wizard': '' });
          return b;
        })(),
      }));
      return;
    }
    const picks = filterEntries(entries, { sort: 'newest' }).slice(0, 3);
    const grid = el('div', { class: 'grid' });
    picks.forEach((e, i) => grid.append(animationCard(e, { priority: i === 0 })));
    featuredHost.append(grid);
  }

  /* ── 首页里的软件区：给"这是什么"一个准确答案 ── */
  const aboutHost = $('#ba-home-software');
  if (aboutHost) {
    clear(aboutHost);
    const rows = [
      ['它做什么', '登录 Windows 后立刻全屏播放一段你选的片头，播完自动消失。'],
      ['它不做什么', '不改开机画面、不碰引导、不要管理员、不装驱动。任何时刻按 Esc 或点一下就退出。'],
      ['要装什么', SOFTWARE.requirements.runtime],
    ];
    const dl = el('dl', { class: 'facts' });
    for (const [k, v] of rows) {
      dl.append(el('dt', { text: k }));
      dl.append(el('dd', { text: v }));
    }
    aboutHost.append(dl);
  }

  document.body.dataset.ready = 'true';
  return { entries };
}

export { SORTS };
