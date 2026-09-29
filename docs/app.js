/* 纯函数部分导出，方便在 Node 里跑单测；DOM 部分只在浏览器里执行。 */

export const REPO = 'NativeDog1/-Boot-Animation-Community-';
export const BRANCH = 'main';

/** 目录的远端候选地址，**按顺序**尝试（不是竞速 —— 见下）。
 *
 *  为什么不能竞速：jsDelivr 会缓存分支引用（最长 12 小时），所以新投稿之后它常常
 *  返回**过期**的目录；而缓存的响应又偏偏是最快的 —— 竞速会让"过期的那个赢"，
 *  表现就是「我投稿了，网页却没显示」。实测踩到过。
 *
 *  所以：先 raw（无长缓存，本机实测直连可达），失败再退到 jsDelivr
 *  （适合 raw 被墙的网络环境）。机器人上架时也会顺手 purge 一下 jsDelivr。 */
export function catalogSources() {
  return [
    `https://raw.githubusercontent.com/${REPO}/${BRANCH}/data/index.json`,
    `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/data/index.json`,
  ];
}

/** 按顺序尝试远端源，全失败再回退到本地文件（开发时用）。 */
export async function loadCatalog(fetchImpl = fetch) {
  const errors = [];
  for (const url of catalogSources()) {
    try {
      const r = await fetchImpl(url, { cache: 'no-cache' });
      if (!r.ok) { errors.push(url + ' → HTTP ' + r.status); continue; }
      const d = await r.json();
      if (!Array.isArray(d)) { errors.push(url + ' → 返回的不是数组'); continue; }
      return { entries: d, url: url.includes('jsdelivr') ? 'jsDelivr CDN' : 'GitHub raw' };
    } catch (e) {
      errors.push(url + ' → ' + (e && e.message ? e.message : e));
    }
  }

  const local = 'data/index.json';
  try {
    const r = await fetchImpl(local, { cache: 'no-cache' });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data)) return { entries: data, url: local };
    }
  } catch { /* 本地也没有就报错 */ }

  throw new Error('目录取不到：' + errors.join('；'));
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

export function submitIssueUrl(prefill = {}) {
  const p = new URLSearchParams();
  p.set('template', 'submit-animation.yml');
  if (prefill.name) p.set('title', '[投稿] ' + prefill.name);
  // issue form 的字段可以用同名字段预填；若某个字段没填上，用户在表单里补一下即可
  for (const k of ['name', 'slug', 'video', 'license', 'nsfw', 'tags', 'description']) {
    if (prefill[k]) p.set(k, prefill[k]);
  }
  return `https://github.com/${REPO}/issues/new?${p.toString()}`;
}

/** 把中文标题转成合法的英文标识（音译做不了，只做保守替换，剩下的让用户自己改） */
export function suggestSlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

/**
 * 本地文件的准入检查。返回 { ok, issues[], warn[] }。
 * 纯函数，方便测试；规则与 SCHEMA.md 保持一致。
 */
export function validateLocalFile(meta) {
  const issues = [];
  const warn = [];
  const bytes = Number(meta.bytes || 0);
  const duration = Number(meta.duration || 0);
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);

  if (!bytes) issues.push('读不到文件大小');
  else if (bytes > 100 * 1024 * 1024) issues.push(`文件 ${formatBytes(bytes)}，超过社区上限 100 MB（4K 单个太大，建议出 1440p）`);
  else if (bytes > 30 * 1024 * 1024) warn.push(`文件 ${formatBytes(bytes)}，偏大 —— 用户下载会慢，建议压到 30 MB 以内`);

  if (duration && duration > 30) issues.push(`时长 ${duration.toFixed(1)} 秒，超过上限 30 秒（开机动画建议 5–10 秒）`);
  else if (duration && duration > 12) warn.push(`时长 ${duration.toFixed(1)} 秒，偏长 —— 开机动画超过 10 秒容易让人烦`);

  if (width && height) {
    if (width > 3840 || height > 3840) issues.push(`${width}×${height} 超过 4K，没必要`);
    else if (height >= 2160) warn.push('是 4K 素材 —— 能通过，但单个文件大、下载慢，社区主流是 1440p');
  } else {
    warn.push('读不到分辨率，确认一下是不是标准 mp4');
  }

  return { ok: issues.length === 0, issues, warn };
}

/** 在浏览器里算 sha256（WebCrypto），大文件会占用较多内存，所以先卡上限。 */
export async function sha256OfFile(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 读视频元数据并在第 1 秒抽一帧当预览图。 */
export async function readVideoMeta(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.muted = true;
  v.src = url;
  try {
    await new Promise((resolve, reject) => {
      v.onloadedmetadata = resolve;
      v.onerror = () => reject(new Error('浏览器读不了这个文件，确认是 mp4 吗'));
      setTimeout(() => reject(new Error('读取超时')), 15000);
    });
    let previewDataUrl = '';
    try {
      v.currentTime = Math.min(1, (v.duration || 2) / 2);
      await new Promise((resolve) => {
        v.onseeked = resolve;
        setTimeout(resolve, 3000);
      });
      const c = document.createElement('canvas');
      c.width = Math.min(1280, v.videoWidth || 1280);
      c.height = Math.round((c.width * (v.videoHeight || 720)) / (v.videoWidth || 1280));
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      previewDataUrl = c.toDataURL('image/jpeg', 0.85);
    } catch { /* 抽帧失败不影响投稿 */ }
    return {
      width: v.videoWidth,
      height: v.videoHeight,
      duration: v.duration,
      previewDataUrl,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------------------------------------------------------------- 浏览器端 */

const isBrowser = typeof document !== 'undefined';
if (isBrowser) start();

async function start() {
  const $ = (id) => document.getElementById(id);
  let all = [];
  let state = { query: '', tag: null, showNsfw: false, sort: 'newest' };

  // 投稿入口先打开页内向导，用户不用一上来就面对 GitHub
  $('submitLink').onclick = (e) => { e.preventDefault(); openWizard(); };
  $('submitLink2').onclick = (e) => { e.preventDefault(); openWizard(); };
  setupWizard();

  showSkeleton();

  async function load() {
    $('err').hidden = true;
    try {
      const { entries, url } = await loadCatalog();
      all = entries;
      $('stats').textContent = `共 ${all.length} 个动画 · 数据源 ${url}`;
      renderTags();
      renderSort();
      render();
    } catch (e) {
      $('grid').replaceChildren();
      $('err').hidden = false;
      $('err').innerHTML = '目录加载失败：' + esc(e.message)
        + '<br><button class="btn" id="retry" style="margin-top:12px">重试</button>';
      const r = $('retry');
      if (r) r.onclick = () => { showSkeleton(); load(); };
    }
  }

  function showSkeleton() {
    $('empty').hidden = true;
    const grid = $('grid');
    grid.replaceChildren(...Array.from({ length: 6 }, () => {
      const d = document.createElement('div');
      d.className = 'skeleton';
      d.innerHTML = '<div class="sk-thumb"></div><div class="sk-line"></div><div class="sk-line short"></div>';
      return d;
    }));
  }

  await load();

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
    // 预览图挂了也要有交代，别留一块空白
    const img = el.querySelector('img');
    img.onerror = () => {
      const box = el.querySelector('.thumb');
      const fb = document.createElement('div');
      fb.className = 'fallback';
      fb.textContent = '预览图加载失败';
      box.appendChild(fb);
    };
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

  /* ---------------------------------------------------------------- 投稿向导 */

  let wizMeta = null;

  function setupWizard() {
    const drop = $('drop');
    const pick = $('pickFile');
    drop.onclick = () => pick.click();
    drop.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.click(); }
    };
    pick.onchange = () => { if (pick.files && pick.files[0]) handleFile(pick.files[0]); };
    ['dragenter', 'dragover'].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    $('closeWizard').onclick = () => $('wizard').close();
    $('wizCopy').onclick = () => copyMeta();
  }

  function openWizard() {
    const dlg = $('wizard');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  async function handleFile(file) {
    const prog = $('wizProgress');
    const box = $('wizResult');
    prog.hidden = false;
    prog.textContent = '正在读取 ' + file.name + '（' + formatBytes(file.size) + '）…';
    box.innerHTML = '<p class="muted small">正在本地计算 sha256，大文件要等一会儿。视频不会上传到我们这里。</p>';
    try {
      const meta = await readVideoMeta(file);
      prog.textContent = '正在本地计算 sha256（' + formatBytes(file.size) + '）…';
      const sha256 = await sha256OfFile(file);
      wizMeta = Object.assign(
        { name: file.name.replace(/\.[^.]+$/, ''), file: file.name, bytes: file.size, sha256 },
        meta,
      );
      prog.hidden = true;
      renderWizard();
    } catch (e) {
      prog.hidden = true;
      box.innerHTML = '<p class="wiz-list bad">读不了这个文件：' + esc(e.message) + '</p>';
    }
  }

  function renderWizard() {
    const m = wizMeta;
    const check = validateLocalFile(m);
    const slug = suggestSlug(m.name) || 'my-animation';
    const box = $('wizResult');
    box.innerHTML = `
      <div class="wiz-card">
        ${m.previewDataUrl ? '<img src="' + m.previewDataUrl + '" alt="预览帧">' : '<div class="muted small">（没能抽到预览帧）</div>'}
        <div>
          <dl class="wiz-facts">
            <dt>文件</dt><dd>${esc(m.file)}</dd>
            <dt>体积</dt><dd>${esc(formatBytes(m.bytes))}</dd>
            <dt>分辨率</dt><dd>${esc(m.width ? m.width + '×' + m.height : '—')}</dd>
            <dt>时长</dt><dd>${esc(m.duration ? m.duration.toFixed(1) + ' 秒' : '—')}</dd>
            <dt>sha256</dt><dd>${esc(m.sha256.slice(0, 24))}…</dd>
          </dl>
          ${check.issues.length ? '<ul class="wiz-list bad">' + check.issues.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : ''}
          ${check.warn.length ? '<ul class="wiz-list warn">' + check.warn.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : ''}
          ${check.ok ? '<p class="small" style="color:#5fd38a">✅ 符合社区规范，可以投稿</p>' : ''}
        </div>
      </div>`;

    $('wizBigHint').hidden = m.bytes <= 25 * 1024 * 1024;
    $('wizSubmit').href = submitIssueUrl({ name: m.name, slug });
    // 预览图不用用户管：机器人会从视频里自己截一帧（挑最亮的候选帧）并提交进仓库
  }

  function copyMeta() {
    if (!wizMeta) { toast('先选一个视频文件', true); return; }
    const m = wizMeta;
    const text = [
      '名称：' + m.name,
      '文件：' + m.file,
      '分辨率：' + (m.width ? m.width + '×' + m.height : '—'),
      '时长：' + (m.duration ? m.duration.toFixed(2) + ' 秒' : '—'),
      '体积：' + m.bytes + ' 字节',
      'sha256：' + m.sha256,
    ].join('\n');
    navigator.clipboard.writeText(text).then(
      () => toast('已复制，粘贴到 GitHub 表单里就行'),
      () => toast('复制失败，请手动选中复制', true),
    );
  }

  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isErr ? ' err' : '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
