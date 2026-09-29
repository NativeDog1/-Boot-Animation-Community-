/* 纯函数部分导出，方便在 Node 里跑单测；DOM 部分只在浏览器里执行。 */

export const REPO = 'NativeDog1/-Boot-Animation-Community-';
export const BRANCH = 'main';

/** 目录的远端候选地址。
 *  实测：本机 jsDelivr 直连不通、raw.githubusercontent 直连可用；但有些网络环境正好相反。
 *  所以不猜顺序 —— 两个并行请求、谁先成功用谁。 */
export function catalogSources() {
  return [
    `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/data/index.json`,
    `https://raw.githubusercontent.com/${REPO}/${BRANCH}/data/index.json`,
  ];
}

/** 并行竞速两个 CDN，都失败再回退到本地文件（开发时用）。 */
export async function loadCatalog(fetchImpl = fetch) {
  const remotes = catalogSources();
  try {
    const entries = await new Promise((resolve, reject) => {
      let failed = 0;
      let settled = false;
      for (const url of remotes) {
        fetchImpl(url, { cache: 'no-cache' })
          .then(async (r) => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const d = await r.json();
            if (!Array.isArray(d)) throw new Error('返回的不是数组');
            return d;
          })
          .then((d) => { if (!settled) { settled = true; resolve(d); } })
          .catch(() => {
            failed++;
            // 只有全部失败、且还没有成功过，才判定远端不可用
            if (failed === remotes.length && !settled) reject(new Error('两个远端源都不可达'));
          });
      }
    });
    return { entries, url: '远端 CDN' };
  } catch {
    /* 落到本地 */
  }

  const local = 'data/index.json';
  const r = await fetchImpl(local, { cache: 'no-cache' });
  if (!r.ok) throw new Error('本地 ' + local + ' → HTTP ' + r.status);
  const data = await r.json();
  if (!Array.isArray(data)) throw new Error('本地 ' + local + ' 不是数组');
  return { entries: data, url: local };
}

export function formatBytes(n) {
  const v = Number(n);
  if (!isFinite(v) || v <= 0) return '—';
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(0) + ' KB';
  return (v / 1024 / 1024).toFixed(1) + ' MB';
}

export function formatDuration(sec) {
  const v = Number(sec);
  if (!isFinite(v) || v <= 0) return '—';
  return v.toFixed(1) + ' 秒';
}

export function resolutionLabel(e) {
  return e && e.width && e.height ? `${e.width}×${e.height}` : '—';
}

/** 把所有条目里出现过的标签按出现次数排序。 */
export function collectTags(entries) {
  const count = new Map();
  for (const e of entries) for (const t of e.tags || []) count.set(t, (count.get(t) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/**
 * 过滤 + 排序。纯函数，便于测试。
 * @param {object[]} entries 目录条目
 * @param {{query?:string, tag?:string|null, showNsfw?:boolean, sort?:string}} opts
 */
export function filterEntries(entries, opts = {}) {
  const q = (opts.query || '').trim().toLowerCase();
  const tag = opts.tag || null;
  let out = entries.filter((e) => {
    if (e.nsfw && !opts.showNsfw) return false;
    if (tag && !(e.tags || []).includes(tag)) return false;
    if (!q) return true;
    const hay = [e.name, e.author, e.description, e.id, ...(e.tags || [])]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
  const by = opts.sort || 'newest';
  out = out.slice().sort((a, b) => {
    if (by === 'smallest') return (a.bytes || 0) - (b.bytes || 0);
    if (by === 'largest') return (b.bytes || 0) - (a.bytes || 0);
    if (by === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
    return String(b.submitted || '').localeCompare(String(a.submitted || ''));
  });
  return out;
}

/** 网页唤起客户端的地址；客户端注册 bootanim:// 协议来接收。
 *  把 name/author 也带上，客户端就不用去解析 index.json 了（省掉一个 JSON 依赖）。 */
export function installUrl(entry) {
  const q = (v) => encodeURIComponent(v == null ? '' : v);
  return 'bootanim://install'
    + '?id=' + q(entry.id)
    + '&url=' + q(entry.video)
    + '&sha256=' + q(entry.sha256)
    + '&bytes=' + q(entry.bytes)
    + '&name=' + q(entry.name)
    + '&author=' + q(entry.author);
}

export function submitIssueUrl() {
  return `https://github.com/${REPO}/issues/new?template=submit-animation.yml`;
}

/* ---------------------------------------------------------------- 浏览器端 */

const isBrowser = typeof document !== 'undefined';
if (isBrowser) start();

async function start() {
  const $ = (id) => document.getElementById(id);
  let all = [];
  let state = { query: '', tag: null, showNsfw: false, sort: 'newest' };

  $('submitLink').href = submitIssueUrl();
  $('submitLink2').href = submitIssueUrl();

  try {
    const { entries, url } = await loadCatalog();
    all = entries;
    $('stats').textContent = `共 ${all.length} 个动画 · 数据源 ${new URL(url, location.href).host || '本地'}`;
    renderTags();
    renderSort();
    render();
  } catch (e) {
    $('err').hidden = false;
    $('err').textContent = '目录加载失败：' + e.message;
  }

  $('q').addEventListener('input', (ev) => { state.query = ev.target.value; render(); });
  $('nsfw').addEventListener('change', (ev) => { state.showNsfw = ev.target.checked; render(); });

  function renderTags() {
    const box = $('tags');
    const tags = collectTags(all).slice(0, 24);
    if (tags.length === 0) { box.innerHTML = '<span class="muted small">还没有标签</span>'; return; }
    const mk = (label, value) => {
      const b = document.createElement('button');
      b.className = 'chip' + (state.tag === value ? ' on' : '');
      b.textContent = label;
      b.onclick = () => { state.tag = state.tag === value ? null : value; renderTags(); render(); };
      return b;
    };
    box.replaceChildren(mk('全部', null), ...tags.map((t) => mk(t, t)));
  }

  function renderSort() {
    const box = $('sort');
    const opts = [['newest', '最新'], ['smallest', '体积最小'], ['largest', '体积最大'], ['name', '名称']];
    box.replaceChildren(...opts.map(([v, label]) => {
      const b = document.createElement('button');
      b.className = 'chip' + (state.sort === v ? ' on' : '');
      b.textContent = label;
      b.onclick = () => { state.sort = v; renderSort(); render(); };
      return b;
    }));
  }

  function render() {
    const list = filterEntries(all, state);
    const grid = $('grid');
    $('empty').hidden = list.length > 0;
    grid.replaceChildren(...list.map(card));
  }

  function card(e) {
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <div class="thumb"><img loading="lazy" alt="" src="${esc(e.preview || '')}">
        ${e.nsfw ? '<span class="badge nsfw">NSFW</span>' : ''}
        <span class="badge res">${esc(resolutionLabel(e))}</span>
      </div>
      <div class="card-body">
        <h3>${esc(e.name || e.id)}</h3>
        <p class="muted small">${esc(e.author || '')} · ${esc(formatBytes(e.bytes))} · ${esc(formatDuration(e.duration))}</p>
        <div class="chips small">${(e.tags || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      </div>`;
    el.onclick = () => openDetail(e);
    return el;
  }

  function openDetail(e) {
    $('dName').textContent = e.name || e.id;
    $('dAuthor').textContent = (e.author || '') + (e.license ? ' · ' + e.license : '');
    $('dDesc').textContent = e.description || '';
    $('dFacts').innerHTML = [
      ['解析度', resolutionLabel(e)],
      ['时长', formatDuration(e.duration)],
      ['体积', formatBytes(e.bytes)],
      ['音轨', e.has_audio ? '有' : '无'],
      ['sha256', (e.sha256 || '').slice(0, 16) + '…'],
    ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    $('player').src = e.video || '';
    $('install').href = installUrl(e);
    $('download').href = e.video || '';
    const dlg = $('detail');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  $('closeDetail').onclick = () => {
    $('player').pause();
    $('player').src = '';
    $('detail').close();
  };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
