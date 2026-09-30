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

  /* ── 投稿流程（照实写） ── */
  if (guideHost) {
    clear(guideHost);

    const steps = el('ol', { class: 'steps' });
    const items = [
      ['点「投稿动画」', '页面会打开一个向导：选本地 mp4 → 浏览器算 sha256、抽一帧预览图、检查体积与时长 → 生成预填好的 GitHub 表单。'],
      ['在 GitHub 表单里提交 Issue', '同一个视频文件直接拖进表单的「视频」文本框，GitHub 会托管它并自动填好直链。表单里还要填名称、许可、是否含不适宜内容。'],
      ['机器人自动校验', '它会检查：必填项是否齐全、两个直链是否可达且不是网页、声明的字节数与实际是否一致、哈希格式、体积与时长上限。'],
      ['通过就自动上架', '机器人写好条目文件、刷新 data/index.json、回复「已上架」并关闭 Issue。不通过会在 Issue 里列出缺哪一项，**直接编辑该 Issue 改正即可自动重试**。'],
      ['出现在网站与客户端里', '网站每次打开都读最新目录；客户端刷新目录后就能在「浏览社区」里看到。'],
    ];
    for (const [title, text] of items) {
      steps.append(el('li', {}, [el('b', { text: title }), el('p', { class: 'muted small', text })]));
    }
    // 上面循环里没法优雅插文本节点，重写一遍（内容少，直白更好）
    clear(steps);
    for (const [title, text] of items) {
      const li = el('li');
      li.append(el('b', { text: title }));
      li.append(el('p', { class: 'muted small', text }));
      steps.append(li);
    }
    guideHost.append(steps);

    const actions = el('div', { class: 'btn-row' });
    const submit = el('button', { class: 'btn btn--primary', type: 'button', text: '投稿动画', 'data-open-wizard': '' });
    actions.append(submit);
    actions.append(el('a', {
      class: 'btn', href: issueUrl('submit-animation.yml'), target: '_blank', rel: 'noopener', text: '直接打开 GitHub 表单',
    }));
    actions.append(el('a', {
      class: 'btn btn--ghost', href: issueUrl('report.yml'), target: '_blank', rel: 'noopener', text: '举报某条内容',
    }));
    actions.append(el('a', { class: 'btn btn--ghost', href: `${REPO_URL}/blob/main/SCHEMA.md`, target: '_blank', rel: 'noopener', text: '字段规范 SCHEMA.md' }));
    guideHost.append(actions);

    guideHost.append(el('div', { class: 'callout callout--info', style: 'margin-top:var(--s-4)' }, [
      el('div', {}, [
        el('b', { text: '为什么是 Issue 而不是 Pull Request：' }),
        el('span', {
          text: ' 投稿需要校验"这个直链真的能下、哈希真的对得上"—— 这些机器能做完，不该让投稿人手写 YAML 再等人工审核。Issue 表单 + 机器人 = 自助投稿但不失控。要批量改数据（比如统一改标签）时，维护者仍然可以直接提 PR 改 data/animations/。',
        }),
      ]),
    ]));

    guideHost.append(el('div', { class: 'callout callout--warn', style: 'margin-top:var(--s-3)' }, [
      el('div', {}, [
        el('b', { text: '内容与下架：' }),
        el('span', {
          text: ' 本目录是自助投稿 + 事后处置，没有前置人工审核。每条都必须显式标注是否含不适宜内容（漏填会校验失败）；客户端默认隐藏这类条目。任何人对任何条目都可以提举报 Issue，核实后直接下架。',
        }),
      ]),
    ]));
  }

  document.body.dataset.ready = 'true';
}
