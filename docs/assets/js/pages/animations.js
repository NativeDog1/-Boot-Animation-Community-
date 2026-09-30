/**
 * animations.js — 动画库（站点的核心页面）。
 *
 * 和"客户端渲染 SPA"的区别：**这一页的静态 HTML 里已经有全部卡片**（生成器产出，
 * 爬虫与禁用 JS 的用户都能看到）。这个模块负责把它变成可筛选、可深链的界面：
 * 任何筛选条件都写进 URL，所以「我筛好的这个列表」可以直接分享出去。
 */
import { $, el, icon, clear, toast, skeletonGrid, stateBlock } from '../ui/dom.js';
import { animationCard, emptyCatalogState } from '../ui/card.js';
import { collectTags, filterEntries, SORTS, RESOLUTION_LABELS, DURATION_LABELS, entryPath } from '../catalog.js';
import { rootPath } from '../config.js';

const PAGE_SIZE = 48;

/** 从 URL 读筛选状态（可分享、可后退）。 */
function readState() {
  const p = new URLSearchParams(location.search);
  return {
    query: p.get('q') || '',
    tag: p.get('tag') || null,
    creator: p.get('creator') || null,
    resolution: p.get('res') || null,
    duration: p.get('dur') || null,
    sort: SORTS.some((s) => s.id === p.get('sort')) ? p.get('sort') : 'newest',
    showNsfw: p.get('nsfw') === '1',
    seed: Number(p.get('seed')) || Math.floor(Math.random() * 1e6),
  };
}

function writeState(state, { replace = true } = {}) {
  const p = new URLSearchParams();
  if (state.query) p.set('q', state.query);
  if (state.tag) p.set('tag', state.tag);
  if (state.creator) p.set('creator', state.creator);
  if (state.resolution) p.set('res', state.resolution);
  if (state.duration) p.set('dur', state.duration);
  if (state.sort && state.sort !== 'newest') p.set('sort', state.sort);
  if (state.showNsfw) p.set('nsfw', '1');
  if (state.sort === 'random') p.set('seed', String(state.seed));
  const url = location.pathname + (p.toString() ? '?' + p.toString() : '');
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
}

export async function init({ repo }) {
  const main = $('#ba-main');
  const grid = $('#ba-grid');
  const bar = $('#ba-filters');
  const status = $('#ba-status');
  const empty = $('#ba-empty');
  const more = $('#ba-more');
  if (!main || !grid) return;

  let state = readState();
  let all = [];
  let shown = PAGE_SIZE;

  /* ── 取数 ── */
  if (status) status.textContent = '正在读取目录…';
  const skeleton = skeletonGrid(6);
  if (!grid.childElementCount) grid.append(skeleton);

  try {
    all = await repo.getAnimations();
  } catch (error) {
    clear(grid);
    grid.append(
      stateBlock({
        kind: 'error',
        title: '目录取不到',
        text: `${error?.message || error}。目录托管在 GitHub 上，网络不通时就会这样。`,
        action: (() => {
          const b = el('button', { class: 'btn', type: 'button', text: '重试' });
          b.addEventListener('click', () => location.reload());
          return b;
        })(),
      }),
    );
    if (status) status.textContent = '';
    return;
  }

  const tags = collectTags(all);
  const resolutions = [...new Set(all.map((e) => (e.height ? (e.height >= 2000 ? '4k' : e.height >= 1300 ? '1440p' : e.height >= 1000 ? '1080p' : e.height >= 700 ? '720p' : 'sd') : 'unknown')))];

  buildFilterBar();

  function buildFilterBar() {
    if (!bar) return;
    clear(bar);

    // 搜索框
    const search = el('input', {
      class: 'input', type: 'search', value: state.query, placeholder: '在这个列表里搜名称、作者、标签…',
      'aria-label': '在动画库里搜索', autocomplete: 'off',
    });
    search.addEventListener('input', () => {
      state.query = search.value;
      shown = PAGE_SIZE;
      writeState(state);
      render();
    });

    const searchRow = el('div', { class: 'row' }, [search]);

    // 排序
    const sortRow = el('div', { class: 'row' }, [el('span', { class: 'muted small', text: '排序' })]);
    const sortChips = el('div', { class: 'chips' });
    for (const s of SORTS) {
      const chip = el('button', {
        class: 'chip', type: 'button', text: s.label,
        'aria-pressed': state.sort === s.id ? 'true' : 'false',
      });
      chip.addEventListener('click', () => {
        state.sort = s.id;
        if (s.id === 'random') state.seed = Math.floor(Math.random() * 1e6);
        shown = PAGE_SIZE;
        writeState(state);
        buildFilterBar();
        render();
      });
      sortChips.append(chip);
    }
    sortRow.append(sortChips);

    // 不适宜内容开关
    const nsfwInput = el('input', { type: 'checkbox', checked: state.showNsfw, id: 'ba-nsfw' });
    nsfwInput.addEventListener('change', () => {
      state.showNsfw = nsfwInput.checked;
      writeState(state);
      render();
    });
    const nsfwLabel = el('label', { class: 'switch', for: 'ba-nsfw' }, [nsfwInput, el('span', { text: '显示不适宜内容' })]);
    sortRow.append(el('span', { class: 'spacer' }), nsfwLabel);

    bar.append(searchRow, sortRow);

    // 标签
    if (tags.length) {
      const tagRow = el('div', { class: 'row' }, [el('span', { class: 'muted small', text: '标签' })]);
      const chips = el('div', { class: 'chips' });
      const allChip = el('button', {
        class: 'chip', type: 'button', text: '全部',
        'aria-pressed': state.tag === null ? 'true' : 'false',
      });
      allChip.addEventListener('click', () => { state.tag = null; shown = PAGE_SIZE; writeState(state); buildFilterBar(); render(); });
      chips.append(allChip);
      for (const { tag, count } of tags) {
        const chip = el('button', {
          class: 'chip', type: 'button', text: `${tag} ${count}`,
          'aria-pressed': state.tag === tag ? 'true' : 'false',
        });
        chip.addEventListener('click', () => {
          state.tag = state.tag === tag ? null : tag;
          shown = PAGE_SIZE;
          writeState(state);
          buildFilterBar();
          render();
        });
        chips.append(chip);
      }
      tagRow.append(chips);
      bar.append(tagRow);
    }

    // 分辨率（只有真实出现过的档位才显示）
    if (resolutions.length > 1) {
      const resRow = el('div', { class: 'row' }, [el('span', { class: 'muted small', text: '分辨率' })]);
      const chips = el('div', { class: 'chips' });
      for (const r of resolutions) {
        const chip = el('button', {
          class: 'chip', type: 'button', text: RESOLUTION_LABELS[r] || r,
          'aria-pressed': state.resolution === r ? 'true' : 'false',
        });
        chip.addEventListener('click', () => {
          state.resolution = state.resolution === r ? null : r;
          shown = PAGE_SIZE;
          writeState(state);
          buildFilterBar();
          render();
        });
        chips.append(chip);
      }
      resRow.append(chips);
      bar.append(resRow);
    }

    // 时长
    const durations = [...new Set(all.map((e) => (e.duration ? (e.duration <= 5 ? 'short' : e.duration <= 10 ? 'normal' : 'long') : null)).filter(Boolean))];
    if (durations.length > 1) {
      const durRow = el('div', { class: 'row' }, [el('span', { class: 'muted small', text: '时长' })]);
      const chips = el('div', { class: 'chips' });
      for (const d of ['short', 'normal', 'long']) {
        if (!durations.includes(d)) continue;
        const chip = el('button', {
          class: 'chip', type: 'button', text: DURATION_LABELS[d],
          'aria-pressed': state.duration === d ? 'true' : 'false',
        });
        chip.addEventListener('click', () => {
          state.duration = state.duration === d ? null : d;
          shown = PAGE_SIZE;
          writeState(state);
          buildFilterBar();
          render();
        });
        chips.append(chip);
      }
      durRow.append(chips);
      bar.append(durRow);
    }
  }

  function render() {
    const list = filterEntries(all, state);
    clear(grid);

    // 状态行：说清「筛出几个 / 一共几个 / 数据从哪来」
    if (status) {
      const src = repo.source;
      status.textContent = `筛出 ${list.length} 个 · 目录共 ${all.length} 个 · 数据源 ${src}`;
    }

    if (repo.status === 'stale') {
      const banner = stateBlock({
        kind: 'offline',
        title: '当前是离线目录',
        text: '取不到 GitHub 上的最新目录，下面显示的是上次成功读取的缓存。新投稿可能还看不到。',
      });
      banner.style.marginBottom = 'var(--s-5)';
      grid.append(banner);
    }

    if (!list.length) {
      grid.append(
        all.length === 0
          ? emptyCatalogState(() => document.querySelector('[data-open-wizard]')?.click())
          : stateBlock({
            kind: 'empty',
            title: '没有匹配的动画',
            text: '换个关键词，或把下面的筛选清掉。',
            action: (() => {
              const b = el('button', { class: 'btn', type: 'button', text: '清除筛选' });
              b.addEventListener('click', () => {
                state = { ...readState(), query: '', tag: null, creator: null, resolution: null, duration: null, showNsfw: state.showNsfw };
                shown = PAGE_SIZE;
                writeState(state);
                buildFilterBar();
                render();
              });
              return b;
            })(),
          }),
      );
      if (more) more.hidden = true;
      if (empty) empty.hidden = true;
      return;
    }

    const slice = list.slice(0, shown);
    const frag = document.createDocumentFragment();
    slice.forEach((entry, i) => frag.append(animationCard(entry, { priority: i < 4 })));
    grid.append(frag);

    if (more) {
      more.hidden = shown >= list.length;
      more.textContent = `还有 ${list.length - shown} 个 · 继续加载`;
    }
  }

  if (more) {
    more.addEventListener('click', () => {
      shown += PAGE_SIZE;
      render();
    });
  }

  window.addEventListener('popstate', () => {
    state = readState();
    buildFilterBar();
    render();
  });

  render();
  document.body.dataset.ready = 'true';
}

/* 供详情页/其他页面复用：某些地方只想拿"最新 N 个" */
export function latest(entries, n = 6) {
  return filterEntries(entries, { sort: 'newest' }).slice(0, n);
}

export { entryPath, rootPath };
