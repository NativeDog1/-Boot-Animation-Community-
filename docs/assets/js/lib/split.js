/**
 * split.js — 把大视频切成「能拖进 Issue 表单」的分片，并生成一份机器能读的清单。
 *
 * 为什么需要它：GitHub 的 Issue 附件上限是 25 MB，而 4K 原画动辄上百 MB。
 * 与其让投稿人去找第三方网盘，不如在浏览器里把文件切成若干个 <25 MB 的分片 ——
 * 他只要把这些分片**一次性拖进表单**，机器人在服务端按顺序拼回去。
 * 全程留在 GitHub 里，不需要任何第三方托管，也不需要投稿人有仓库。
 *
 * 这里的函数**都是纯的**（除了最后写文件那一步在向导里做），方便单测：
 *   planParts()     算分片边界与文件名
 *   manifestOf()    生成清单字符串
 *   parseManifest() 解析清单（字段与机器人的 Python 实现严格一致）
 * 清单格式的"契约样本"放在 tools/fixtures/parts-manifest.txt，两端各有测试盯着它。
 */

export const PART_PREFIX = 'ba-parts:v1';
/**
 * 每个分片的目标大小。
 *
 * ⚠️ 这个数字是**实测**出来的，不是猜的：投稿 Issue #4/#5 里 GitHub 自己留下了
 * `<!-- Failed to upload "…part1of3.mp4" -->` —— 当时每片 20 MB，三个全被拒。
 * 也就是说 Issue 表单的附件上限**低于 20 MB**（通行的说法是 10 MB），
 * 而不是我们原先以为的 25 MB。所以这里取 9 MB，留出安全余量。
 */
export const DEFAULT_PART_BYTES = 9 * 1024 * 1024;
/** GitHub Issue 表单的附件上限（实测 < 20 MB；按 10 MB 保守处理）。 */
export const ATTACH_LIMIT = 10 * 1024 * 1024;
/** 一次拖拽/一条 Issue 里能带的附件数量（GitHub 通常限制 10 个左右）。 */
export const MAX_PARTS_PER_ISSUE = 10;

/** 这个文件能不能靠"切成附件分片"投上去（一条 Issue 装得下）？ */
export function fitsOneIssue(size) {
  return Number(size) <= DEFAULT_PART_BYTES * MAX_PARTS_PER_ISSUE;
}

/** 分片文件名：零填充到 count 的位数，保证**字母序 = 数字序**（拖进表单后顺序不会乱）。 */
export function partFileName(baseName, index, count) {
  const digits = String(count).length;
  const stem = String(baseName || 'video').replace(/\.[^.]+$/, '') || 'video';
  const ext = (String(baseName || '').match(/\.[A-Za-z0-9]+$/) || ['.mp4'])[0];
  return `${stem}.part${String(index).padStart(digits, '0')}of${String(count).padStart(digits, '0')}${ext}`;
}

/**
 * 算分片方案。
 * @param {number} size 总字节数
 * @param {number} [partBytes] 每片目标大小
 * @returns {{index:number, start:number, end:number, bytes:number, name:string}[]}
 */
export function planParts(size, partBytes = DEFAULT_PART_BYTES, baseName = 'video.mp4') {
  const total = Number(size);
  if (!isFinite(total) || total <= 0) return [];
  const chunk = Math.max(1, Math.min(Number(partBytes) || DEFAULT_PART_BYTES, ATTACH_LIMIT - 1024 * 1024));
  const count = Math.max(1, Math.ceil(total / chunk));
  const parts = [];
  for (let i = 1; i <= count; i += 1) {
    const start = (i - 1) * chunk;
    const end = Math.min(start + chunk, total);
    parts.push({
      index: i,
      start,
      end,
      bytes: end - start,
      name: partFileName(baseName, i, count),
    });
  }
  return parts;
}

/** 生成清单。字段顺序固定，两端实现都按这个顺序读。 */
export function manifestOf(meta) {
  const name = String(meta.name || 'video.mp4').replace(/[;\r\n]/g, '_');
  return [
    PART_PREFIX,
    `name=${name}`,
    `bytes=${Number(meta.bytes) || 0}`,
    `parts=${Number(meta.parts) || 0}`,
    `partbytes=${Number(meta.partBytes) || DEFAULT_PART_BYTES}`,
    `sha256=${String(meta.sha256 || '').toLowerCase()}`,
  ].join(';');
}

/**
 * 解析清单（浏览器端与机器人端行为一致）。
 * @returns {{name:string, bytes:number, parts:number, partBytes:number, sha256:string}|null}
 */
export function parseManifest(text) {
  const raw = String(text || '').trim().replace(/\s+/g, '');
  if (!raw.startsWith(PART_PREFIX)) return null;
  const fields = new Map();
  for (const pair of raw.slice(PART_PREFIX.length).replace(/^;/, '').split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    fields.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  const bytes = Number(fields.get('bytes'));
  const parts = Number(fields.get('parts'));
  const partBytes = Number(fields.get('partbytes'));
  const sha256 = String(fields.get('sha256') || '').toLowerCase();
  if (!isFinite(bytes) || bytes <= 0) return null;
  if (!isFinite(parts) || parts <= 0) return null;
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  return {
    name: String(fields.get('name') || 'video.mp4'),
    bytes,
    parts,
    partBytes: isFinite(partBytes) && partBytes > 0 ? partBytes : DEFAULT_PART_BYTES,
    sha256,
  };
}

/** 给用户看的说明：他下一步要做什么。 */
export function partsHint(parts, totalBytes) {
  const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
  return `已切成 ${parts.length} 个分片（共 ${mb(totalBytes)}）。把这些文件**一次性全选**`
    + `（Ctrl+A）拖进投稿表单的「视频」框 —— 顺序不会乱，机器人会按文件名拼回去。`;
}
