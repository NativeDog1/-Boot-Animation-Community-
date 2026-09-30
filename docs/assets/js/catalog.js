/**
 * catalog.js — 目录的纯逻辑：格式化、筛选、排序、ID/路径、投稿校验。
 *
 * 这里**只允许纯函数**（除了两个明确标注要用浏览器 API 的：算 sha256、读视频元数据）。
 * 页面与组件只调用它们，不自己算格式 —— 这样「1 个动画」在卡片、详情页、搜索里
 * 永远长得一样，也便于在 Node 里直接跑单测。
 *
 * 从旧版 docs/app.js 迁移而来，函数名与语义**逐字保留**（外部可能已经有人依赖）。
 */
import { REPO, REPO_ROOT, BRANCH, catalogSources } from './config.js';

export { REPO, BRANCH, catalogSources };

/* ───────────────────────────── 格式化 ───────────────────────────── */

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

/** 分辨率归档，用于筛选。字段可能缺失，缺失归到「未知」。 */
export function resolutionBucket(e) {
  const h = Number(e && e.height);
  if (!h) return 'unknown';
  if (h >= 2000) return '4k';
  if (h >= 1300) return '1440p';
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  return 'sd';
}

export const RESOLUTION_LABELS = {
  '4k': '4K 及以上',
  '1440p': '1440p',
  '1080p': '1080p',
  '720p': '720p',
  sd: '720p 以下',
  unknown: '未知',
};

/** 时长归档。 */
export function durationBucket(e) {
  const d = Number(e && e.duration);
  if (!isFinite(d) || d <= 0) return 'unknown';
  if (d <= 5) return 'short';
  if (d <= 10) return 'normal';
  return 'long';
}

export const DURATION_LABELS = { short: '5 秒以内', normal: '5–10 秒', long: '10 秒以上', unknown: '未知' };

/** 提交日期 → 可读文案。数据缺了就返回空串，不编造。 */
export function humanDate(value) {
  const s = String(value || '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return '';
  return `${Number(m[1])} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`;
}

/** 是否算「新上架」—— 只跟真实提交日期比，没有日期就不标。 */
export function isNew(entry, days = 14, now = Date.now()) {
  const s = String((entry && entry.submitted) || '');
  const t = Date.parse(s);
  if (!isFinite(t)) return false;
  return now - t < days * 24 * 3600 * 1000;
}

/** 单条动画的规范路径。**软件与网站共享的 Animation ID 就是这个 id。** */
export function entryPath(id) {
  return `animations/${encodeURIComponent(String(id))}/`;
}

export function creatorPath(author) {
  return `creators/${encodeURIComponent(String(author))}/`;
}

/** 字面意义上的「一条都没有」—— 用来决定是否显示空态，而不是编造推荐。 */
export function isEmpty(entries) {
  return !Array.isArray(entries) || entries.length === 0;
}

/* ───────────────────────────── 标签 / 作者 ───────────────────────────── */

/** 把所有条目里出现过的标签按出现次数排序。 */
export function collectTags(entries) {
  const count = new Map();
  for (const e of entries || []) for (const t of e.tags || []) count.set(t, (count.get(t) || 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([t, n]) => ({ tag: t, count: n }));
}

/**
 * 作者聚合。作者名来自条目的 `author` 字段（没有账号系统，就是一个字符串）。
 * @returns {{id:string,name:string,count:number,entries:object[],latest:string}[]}
 */
export function creatorsOf(entries) {
  const map = new Map();
  for (const e of entries || []) {
    const name = String((e && e.author) || '').trim();
    if (!name) continue;
    if (!map.has(name)) map.set(name, { id: name, name, count: 0, entries: [], latest: '' });
    const rec = map.get(name);
    rec.count += 1;
    rec.entries.push(e);
    const s = String(e.submitted || '');
    if (s > rec.latest) rec.latest = s;
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));
}

/* ───────────────────────────── 筛选 / 排序 ───────────────────────────── */

/** 一条记录是否命中关键词。纯字符串匹配，没有后端。 */
export function matchesQuery(e, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const hay = [e.name, e.author, e.description, e.id, e.license, ...(e.tags || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export const SORTS = [
  { id: 'newest', label: '最新' },
  { id: 'name', label: '名称' },
  { id: 'smallest', label: '体积小' },
  { id: 'largest', label: '体积大' },
  { id: 'random', label: '随机' },
];

/**
 * 过滤 + 排序。纯函数，便于测试。
 * 注意：`random` 需要外部传 seed，否则同一页每次重排都会跳 —— 那对用户是干扰。
 * @param {object[]} entries
 * @param {{query?:string, tag?:string|null, creator?:string|null, resolution?:string|null,
 *          duration?:string|null, showNsfw?:boolean, sort?:string, seed?:number}} opts
 */
export function filterEntries(entries, opts = {}) {
  const tag = opts.tag || null;
  const creator = opts.creator || null;
  const resolution = opts.resolution || null;
  const duration = opts.duration || null;

  let out = (entries || []).filter((e) => {
    if (e.nsfw && !opts.showNsfw) return false;
    if (tag && !(e.tags || []).includes(tag)) return false;
    if (creator && String(e.author) !== creator) return false;
    if (resolution && resolutionBucket(e) !== resolution) return false;
    if (duration && durationBucket(e) !== duration) return false;
    return matchesQuery(e, opts.query);
  });

  return sortEntries(out, opts.sort || 'newest', opts.seed);
}

export function sortEntries(list, by = 'newest', seed = 1) {
  const out = (list || []).slice();
  if (by === 'random') return shuffle(out, seed);
  out.sort((a, b) => {
    if (by === 'smallest') return (a.bytes || 0) - (b.bytes || 0);
    if (by === 'largest') return (b.bytes || 0) - (a.bytes || 0);
    if (by === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
    // newest：按 submitted 倒序；同一日期用 id 兜底，保证顺序稳定
    const s = String(b.submitted || '').localeCompare(String(a.submitted || ''));
    return s !== 0 ? s : String(a.id || '').localeCompare(String(b.id || ''));
  });
  return out;
}

/** 确定性洗牌（mulberry32）—— 同一个 seed 结果一致，换一页才变。 */
export function shuffle(list, seed = 1) {
  const out = (list || []).slice();
  let t = (Number(seed) || 1) >>> 0;
  const rnd = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ───────────────────────────── 目录读取 ───────────────────────────── */

/**
 * 按顺序尝试远端源，全失败再回退到本地文件（开发时用）。
 *
 * 为什么不能竞速：jsDelivr 会缓存分支引用（最长 12 小时），所以新投稿之后它常常返回
 * **过期**的目录；而缓存的响应又偏偏是最快的 —— 竞速会让"过期的那个赢"，
 * 表现就是「我投稿了，网页却没显示」。实测踩到过。
 */
export async function loadCatalog(fetchImpl = fetch) {
  const errors = [];
  for (const url of catalogSources()) {
    try {
      const r = await fetchImpl(url, { cache: 'no-cache' });
      if (!r.ok) { errors.push(url + ' → HTTP ' + r.status); continue; }
      const d = await r.json();
      if (!Array.isArray(d)) { errors.push(url + ' → 返回的不是数组'); continue; }
      return { entries: d, url: url.includes('jsdelivr') ? 'jsDelivr CDN' : 'GitHub raw', live: true };
    } catch (e) {
      errors.push(url + ' → ' + (e && e.message ? e.message : e));
    }
  }

  // 本地回退：serve.mjs 会把仓库根的 /data/ 也挂上，所以这里用相对仓库根的路径。
  const local = new URL('data/index.json', REPO_ROOT).href;
  try {
    const r = await fetchImpl(local, { cache: 'no-cache' });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data)) return { entries: data, url: '本地 data/index.json', live: false };
    }
  } catch { /* 本地也没有就报错 */ }

  throw new Error('目录取不到：' + errors.join('；'));
}

/* ───────────────────────────── 软件集成 ───────────────────────────── */

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

/* ───────────────────────────── 投稿 ───────────────────────────── */

export function submitIssueUrl(prefill = {}) {
  const p = new URLSearchParams();
  p.set('template', 'submit-animation.yml');
  if (prefill.name) p.set('title', '[投稿] ' + prefill.name);
  // issue form 的字段可以用同名字段预填；若某个字段没填上，用户在表单里补一下即可
  // parts = 分片投稿的清单（向导切完分片自动生成），格式见 lib/split.js
  for (const k of ['name', 'slug', 'video', 'license', 'nsfw', 'tags', 'description', 'parts']) {
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
 * 纯函数，方便测试；**阈值与机器人和 SCHEMA.md 必须一致**。
 *
 * 关于大文件：上限 2 GB 是对齐 GitHub Release 的单文件上限 —— 那也是大文件唯一
 * 免费的托管路径。所以这里不拦 4K 原画，只提醒"下载体验"和"体积"。
 */
export function validateLocalFile(meta) {
  const issues = [];
  const warn = [];
  const bytes = Number(meta.bytes || 0);
  const duration = Number(meta.duration || 0);
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);

  const MAX_GB_LIMIT = 2000 * 1024 * 1024;   // GitHub Release 单文件上限
  const WARN_LIMIT = 200 * 1024 * 1024;

  if (!bytes) issues.push('读不到文件大小');
  else if (bytes > MAX_GB_LIMIT) issues.push(`文件 ${formatBytes(bytes)}，超过 2 GB —— 这是 GitHub Release 的单文件上限，也是免费方案能支撑的极限`);
  else if (bytes > WARN_LIMIT) warn.push(`文件 ${formatBytes(bytes)}，下载会很久（客户端支持断点续传）。建议同时再提供一版 1440p（约 10 MB）单独投稿`);
  else if (bytes > 10 * 1024 * 1024) warn.push(`文件 ${formatBytes(bytes)}，偏大 —— 超过 10 MB 就无法直接拖进投稿表单，这时贴一个能直接下载的链接即可（机器人会替你搬进社区仓库长期托管，不需要你自己建仓库）`);

  if (duration && duration > 30) issues.push(`时长 ${duration.toFixed(1)} 秒，超过上限 30 秒（开机动画建议 5–10 秒）`);
  else if (duration && duration > 12) warn.push(`时长 ${duration.toFixed(1)} 秒，偏长 —— 开机动画超过 10 秒容易让人烦`);

  if (width && height) {
    if (width > 3840 || height > 3840) issues.push(`${width}×${height} 超过 4K，没必要`);
    else if (height >= 2160) warn.push('是 4K 素材 —— 能通过，体积也会明显更大；建议同时提供一版 1440p');
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
    // 先把视频元素从 blob URL 上摘下来，再撤销它。否则元素可能还在加载那个已经失效的
    // 地址，控制台会刷一串 ERR_FILE_NOT_FOUND（实测一次投稿向导能刷 9 条）——
    // 功能不受影响，但排错时这些噪音会掩盖真问题。
    try {
      v.removeAttribute('src');
      v.load();
    } catch { /* 忽略 */ }
    URL.revokeObjectURL(url);
  }
}

/* ───────────────────────────── 搜索索引 ───────────────────────────── */

/**
 * 供 Ctrl+K 用的扁平索引：动画 + 作者 + 标签 + 文档。
 * 文档项由调用方补充（见 ui/search.js），这样纯逻辑与内容解耦。
 */
export function buildSearchIndex(entries) {
  const items = [];
  for (const e of entries || []) {
    items.push({
      kind: 'animation',
      id: e.id,
      title: e.name,
      subtitle: [e.author, resolutionLabel(e), formatBytes(e.bytes)].filter((x) => x && x !== '—').join(' · '),
      thumb: e.preview || '',
      href: entryPath(e.id),
      keywords: [e.id, e.author, e.license, ...(e.tags || [])].filter(Boolean).join(' ').toLowerCase(),
      nsfw: !!e.nsfw,
    });
  }
  for (const c of creatorsOf(entries)) {
    items.push({
      kind: 'creator',
      id: c.id,
      title: c.name,
      subtitle: `${c.count} 个动画`,
      href: creatorPath(c.id),
      keywords: c.id.toLowerCase(),
    });
  }
  for (const { tag, count } of collectTags(entries)) {
    items.push({
      kind: 'tag',
      id: tag,
      title: tag,
      subtitle: `${count} 个动画`,
      href: `animations/?tag=${encodeURIComponent(tag)}`,
      keywords: tag.toLowerCase(),
    });
  }
  return items;
}

/** 按关键词给索引打分并排序。空查询返回全部（保序），供面板默认列表用。 */
export function searchIndex(items, query, limit = 40) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return (items || []).slice(0, limit);
  const scored = [];
  for (const it of items || []) {
    const title = String(it.title || '').toLowerCase();
    const sub = String(it.subtitle || '').toLowerCase();
    const kw = String(it.keywords || '');
    let score = 0;
    if (title === q) score += 100;
    else if (title.startsWith(q)) score += 60;
    else if (title.includes(q)) score += 40;
    if (sub.includes(q)) score += 12;
    if (kw.includes(q)) score += 8;
    if (it.id && String(it.id).toLowerCase().includes(q)) score += 6;
    if (score > 0) scored.push([score, it]);
  }
  scored.sort((a, b) => b[0] - a[0] || String(a[1].title).localeCompare(String(b[1].title), 'zh'));
  return scored.slice(0, limit).map(([, it]) => it);
}
