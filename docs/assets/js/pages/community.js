/**
 * community.js — 社区页：最新上架、作者、**真实的投稿流程**。
 *
 * 注意：这里描述的流程必须和仓库里实际跑的机器人一致 —— 投稿走 **GitHub Issue 表单**，
 * 机器人校验（直链可达、哈希、体积、时长）通过后自动上架并关闭 Issue。
 * 不是"fork 然后提 PR"那种想象出来的流程。维护者批量改数据时才用 PR。
 */
import { $, el, icon, clear, stateBlock } from '../ui/dom.js';
import { animationCard, creatorCard } from '../ui/card.js';
import { filterEntries, creatorsOf } from '../catalog.js';
import { rootPath, REPO_URL, issueUrl } from '../config.js';

export async function init({ repo }) {
  const latestHost = $('#ba-community-latest');
  const creatorsHost = $('#ba-community-creators');
  const guideHost = $('#ba-community-guide');
  const statusHost = $('#ba-community-status');

  let entries = [];
  let failed = null;
  try {
    entries = await repo.getAnimations();
  } catch (error) {
    failed = error;
  }

  if (statusHost) {
    statusHost.textContent = failed ? '目录取不到，下面显示不了实时内容' : `${entries.length} 个动画 · ${creatorsOf(entries).length} 位作者`;
  }

  /* ── 最新上架 ── */
  if (latestHost) {
    clear(latestHost);
    if (failed || !entries.length) {
      latestHost.append(stateBlock({
        kind: failed ? 'offline' : 'empty',
        title: failed ? '目录取不到' : '目录里还没有动画',
        text: failed ? String(failed.message || failed) : '第一条完全可以是你的。投稿表单会自动帮你算哈希、抽预览图。',
        action: el('a', { class: 'btn', href: rootPath('animations/'), text: '去动画库' }),
      }));
    } else {
      const grid = el('div', { class: 'grid' });
      for (const e of filterEntries(entries, { sort: 'newest' }).slice(0, 6)) grid.append(animationCard(e));
      latestHost.append(grid);
    }
  }

  /* ── 作者 ── */
  if (creatorsHost) {
    clear(creatorsHost);
    const creators = creatorsOf(entries);
    if (creators.length) {
      const grid = el('div', { class: 'grid' });
      for (const c of creators.slice(0, 8)) grid.append(creatorCard(c));
      creatorsHost.append(grid);
      if (creators.length > 8) {
        creatorsHost.append(el('div', { class: 'btn-row', style: 'margin-top:var(--s-4)' }, [
          el('a', { class: 'btn', href: rootPath('creators/'), text: `查看全部 ${creators.length} 位作者` }),
        ]));
      }
    } else {
      creatorsHost.append(el('p', { class: 'muted small', text: '还没有作者 —— 上架第一条动画之后这里就有名字了。' }));
    }
  }

  /* ── 投稿流程 ──
     这一段（步骤、为什么用 Issue、内容与下架）是**生成器预渲染的静态内容**：
     它是内容而不是动态列表，所以关掉 JS 也必须看得到，爬虫也要读得到。
     这里只在缺少静态内容时兜底渲染一次。 */
  if (guideHost && !guideHost.childElementCount) {
    guideHost.append(el('p', {
      class: 'muted small',
      text: '投稿流程说明没能加载。直接看仓库里的 README 与 SCHEMA.md，或点下面的按钮打开投稿表单。',
    }));
    const actions = el('div', { class: 'btn-row' });
    actions.append(el('button', { class: 'btn btn--primary', type: 'button', text: '投稿动画', 'data-open-wizard': '' }));
    actions.append(el('a', {
      class: 'btn', href: issueUrl('submit-animation.yml'), target: '_blank', rel: 'noopener', text: '直接打开 GitHub 表单',
    }));
    guideHost.append(actions);
  }

  document.body.dataset.ready = 'true';
}
