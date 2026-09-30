/**
 * catalog.test.mjs — 目录纯逻辑的单元测试。零依赖，用 Node 自带的测试运行器。
 *
 *   node --test tools/            # 或 npm test
 *
 * 为什么这些逻辑值得测：投稿准入的阈值（100 MB / 30 秒 / 4K）、目录源的
 * **按顺序**回退（不是竞速 —— 竞速会让过期的 CDN 缓存赢）、深链参数的编码，
 * 这些一旦写错，表现都是"看起来正常但行为是错的"，只能靠测试兜住。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatBytes, formatDuration, resolutionLabel, resolutionBucket, durationBucket,
  collectTags, creatorsOf, filterEntries, sortEntries, shuffle, matchesQuery,
  installUrl, submitIssueUrl, suggestSlug, validateLocalFile,
  entryPath, creatorPath, humanDate, isNew,
  buildSearchIndex, searchIndex, loadCatalog, catalogSources,
} from '../docs/assets/js/catalog.js';

/* ───────────────────────── 格式化 ───────────────────────── */

test('formatBytes：非法值给「—」，不编造 0 B', () => {
  for (const bad of [0, -1, null, undefined, NaN, 'abc']) {
    assert.equal(formatBytes(bad), '—');
  }
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(1024 * 1024 * 3.25), '3.3 MB');
});

test('formatDuration：一律一位小数 + 「秒」', () => {
  assert.equal(formatDuration(7.1), '7.1 秒');
  assert.equal(formatDuration(12.34), '12.3 秒');
  // 注意「半路」值：7.05 在二进制浮点里略小于 7.05，toFixed(1) 给的是 "7.0"。
  // 显示用不要求严格四舍五入，所以这不是 bug —— 但测试不能假设它会进位。
  assert.equal(formatDuration(7.05), '7.0 秒');
  assert.equal(formatDuration(0), '—');
  assert.equal(formatDuration('x'), '—');
});

test('resolutionLabel：缺宽高就是「—」，不猜', () => {
  assert.equal(resolutionLabel({ width: 2560, height: 1440 }), '2560×1440');
  assert.equal(resolutionLabel({ width: 1920 }), '—');
  assert.equal(resolutionLabel(null), '—');
});

test('resolutionBucket / durationBucket：边界要落在对的一侧', () => {
  assert.equal(resolutionBucket({ height: 2160 }), '4k');
  assert.equal(resolutionBucket({ height: 1440 }), '1440p');
  assert.equal(resolutionBucket({ height: 1080 }), '1080p');
  assert.equal(resolutionBucket({ height: 720 }), '720p');
  assert.equal(resolutionBucket({ height: 480 }), 'sd');
  assert.equal(resolutionBucket({}), 'unknown');

  assert.equal(durationBucket({ duration: 5 }), 'short');
  assert.equal(durationBucket({ duration: 5.1 }), 'normal');
  assert.equal(durationBucket({ duration: 10 }), 'normal');
  assert.equal(durationBucket({ duration: 10.1 }), 'long');
  assert.equal(durationBucket({}), 'unknown');
});

test('humanDate / isNew：没有日期就不假装有', () => {
  assert.equal(humanDate('2026-09-29'), '2026 年 9 月 29 日');
  assert.equal(humanDate(''), '');
  assert.equal(humanDate('乱写'), '');

  const now = Date.parse('2026-09-30T00:00:00Z');
  assert.equal(isNew({ submitted: '2026-09-29' }, 14, now), true);
  assert.equal(isNew({ submitted: '2026-08-01' }, 14, now), false);
  assert.equal(isNew({}, 14, now), false);
});

/* ───────────────────────── 聚合 ───────────────────────── */

test('collectTags：按出现次数降序，同次数按名字升序', () => {
  const tags = collectTags([
    { tags: ['红色', '赛博'] },
    { tags: ['红色'] },
    { tags: ['蓝色'] },
  ]);
  assert.deepEqual(tags.map((t) => t.tag), ['红色', '蓝色', '赛博']);
  assert.equal(tags[0].count, 2);
  assert.deepEqual(collectTags([]), []);
  assert.deepEqual(collectTags(null), []);
});

test('creatorsOf：聚合条数、记最近日期、没有作者的条目被忽略', () => {
  const creators = creatorsOf([
    { id: 'a', author: '小明', submitted: '2026-09-01' },
    { id: 'b', author: '小明', submitted: '2026-09-20' },
    { id: 'c', author: '小红', submitted: '2026-09-10' },
    { id: 'd' },
    { id: 'e', author: '   ' },
  ]);
  assert.equal(creators.length, 2);
  assert.equal(creators[0].name, '小明');
  assert.equal(creators[0].count, 2);
  assert.equal(creators[0].latest, '2026-09-20');
  assert.equal(creators[1].count, 1);
});

/* ───────────────────────── 筛选 / 排序 ───────────────────────── */

const ENTRIES = [
  { id: 'x1', name: '赛博霓虹', author: '小明', description: '蓝色数据流', tags: ['赛博', '深色'], submitted: '2026-09-01', bytes: 300, nsfw: false, height: 1440, duration: 7 },
  { id: 'x2', name: 'Cyber Core', author: '小红', description: 'red glow', tags: ['赛博'], submitted: '2026-09-20', bytes: 100, nsfw: false, height: 1080, duration: 3 },
  { id: 'x3', name: '隐藏条目', author: '小明', tags: [], submitted: '2026-09-25', bytes: 200, nsfw: true, height: 2160, duration: 20 },
];

test('filterEntries：默认隐藏 nsfw', () => {
  assert.deepEqual(filterEntries(ENTRIES).map((e) => e.id), ['x2', 'x1']);
  assert.deepEqual(filterEntries(ENTRIES, { showNsfw: true }).map((e) => e.id), ['x3', 'x2', 'x1']);
});

test('filterEntries：标签 / 作者 / 分辨率 / 时长可以叠加', () => {
  assert.deepEqual(filterEntries(ENTRIES, { tag: '赛博' }).map((e) => e.id), ['x2', 'x1']);
  assert.deepEqual(filterEntries(ENTRIES, { creator: '小红' }).map((e) => e.id), ['x2']);
  assert.deepEqual(filterEntries(ENTRIES, { resolution: '1080p' }).map((e) => e.id), ['x2']);
  assert.deepEqual(filterEntries(ENTRIES, { duration: 'short' }).map((e) => e.id), ['x2']);
  assert.deepEqual(filterEntries(ENTRIES, { creator: '小明', duration: 'normal' }).map((e) => e.id), ['x1']);
});

test('matchesQuery：名称/作者/描述/id/标签都能命中；空查询全通过', () => {
  assert.equal(matchesQuery(ENTRIES[0], '霓虹'), true);
  assert.equal(matchesQuery(ENTRIES[0], '小明'), true);
  assert.equal(matchesQuery(ENTRIES[0], '数据流'), true);
  assert.equal(matchesQuery(ENTRIES[0], 'x1'), true);
  assert.equal(matchesQuery(ENTRIES[0], '赛博'), true);
  assert.equal(matchesQuery(ENTRIES[0], '不存在'), false);
  assert.equal(matchesQuery(ENTRIES[0], '   '), true);
  assert.equal(matchesQuery(ENTRIES[0], 'CYBER'), false); // 大小写不敏感只对已转小写的字段
});

test('sortEntries：四种排序各自的语义', () => {
  const all = [...ENTRIES];
  assert.deepEqual(sortEntries(all, 'newest').map((e) => e.id), ['x3', 'x2', 'x1']);
  assert.deepEqual(sortEntries(all, 'smallest').map((e) => e.id), ['x2', 'x3', 'x1']);
  assert.deepEqual(sortEntries(all, 'largest').map((e) => e.id), ['x1', 'x3', 'x2']);
  assert.equal(sortEntries(all, 'name')[0].name <= sortEntries(all, 'name')[1].name, true);
});

test('sortEntries：原数组不被改动', () => {
  const input = [...ENTRIES];
  sortEntries(input, 'smallest');
  assert.deepEqual(input.map((e) => e.id), ['x1', 'x2', 'x3']);
});

test('shuffle：同一 seed 结果一致，且不丢不重', () => {
  const ids = (seed) => shuffle(ENTRIES, seed).map((e) => e.id).sort();
  assert.deepEqual(ids(42), ['x1', 'x2', 'x3']);
  assert.deepEqual(shuffle(ENTRIES, 7).map((e) => e.id), shuffle(ENTRIES, 7).map((e) => e.id));
  // 不同 seed 允许相同（只有 3 个元素），但必须是同一个集合
  assert.deepEqual(ids(99), ids(1));
});

/* ───────────────────────── 路径与深链 ───────────────────────── */

test('entryPath / creatorPath：URL 编码，不产生裸斜杠', () => {
  assert.equal(entryPath('nativedog1__cyber'), 'animations/nativedog1__cyber/');
  assert.equal(entryPath('a/b'), 'animations/a%2Fb/');
  assert.equal(creatorPath('小明'), 'creators/%E5%B0%8F%E6%98%8E/');
});

test('installUrl：协议、参数、编码都对', () => {
  const url = installUrl({
    id: 'me__x', video: 'https://e.com/a.mp4', sha256: 'ab'.repeat(32),
    bytes: 123, name: '中文 名', author: 'me',
  });
  assert.equal(url.startsWith('bootanim://install?'), true);
  const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  assert.equal(q.get('id'), 'me__x');
  assert.equal(q.get('url'), 'https://e.com/a.mp4');
  assert.equal(q.get('sha256'), 'ab'.repeat(32));
  assert.equal(q.get('bytes'), '123');
  assert.equal(q.get('name'), '中文 名'); // 编解码必须往返一致
  assert.equal(q.get('author'), 'me');
});

test('submitIssueUrl：只带允许的字段，标题带前缀', () => {
  const url = submitIssueUrl({ name: '赛博', slug: 'cyber', video: '', license: 'CC0-1.0', nsfw: 'false', 恶意: 'x' });
  const q = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  assert.equal(q.get('template'), 'submit-animation.yml');
  assert.equal(q.get('title'), '[投稿] 赛博');
  assert.equal(q.get('slug'), 'cyber');
  assert.equal(q.get('license'), 'CC0-1.0');
  assert.equal(q.get('video'), null);   // 空值不带
  assert.equal(q.get('恶意'), null);     // 白名单之外的字段一律不带
});

test('suggestSlug：保守替换，中文标题留空让用户自己填', () => {
  assert.equal(suggestSlug('Cyber Neon'), 'cyber-neon');
  assert.equal(suggestSlug('  --Hello--World--  '), 'hello-world');
  assert.equal(suggestSlug('赛博霓虹'), '');
  assert.equal(suggestSlug('a'.repeat(80)).length, 30);
  assert.equal(suggestSlug(null), '');
});

/* ───────────────────────── 投稿准入 ───────────────────────── */

test('validateLocalFile：阈值与 SCHEMA 一致（100MB / 30s / 4K）', () => {
  const ok = validateLocalFile({ bytes: 10 * 1024 * 1024, duration: 7, width: 2560, height: 1440 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(ok.warn, []);

  assert.equal(validateLocalFile({ bytes: 101 * 1024 * 1024, duration: 7, width: 1920, height: 1080 }).ok, false);
  assert.equal(validateLocalFile({ bytes: 1024, duration: 31, width: 1920, height: 1080 }).ok, false);
  assert.equal(validateLocalFile({ bytes: 1024, duration: 7, width: 4000, height: 4000 }).ok, false);
  assert.equal(validateLocalFile({ bytes: 0, duration: 7, width: 1920, height: 1080 }).ok, false);
});

test('validateLocalFile：超限但是警告的情况要放行', () => {
  const big = validateLocalFile({ bytes: 40 * 1024 * 1024, duration: 20, width: 3840, height: 2160 });
  assert.equal(big.ok, true);
  assert.equal(big.warn.length, 3); // 体积偏大 + 时长偏长 + 4K
  const noRes = validateLocalFile({ bytes: 1024, duration: 5 });
  assert.equal(noRes.ok, true);
  assert.equal(noRes.warn.some((w) => w.includes('分辨率')), true);
});

/* ───────────────────────── 搜索索引 ───────────────────────── */

test('buildSearchIndex：动画 / 作者 / 标签三类都在，nsfw 标记带过去', () => {
  const index = buildSearchIndex(ENTRIES);
  assert.equal(index.filter((i) => i.kind === 'animation').length, 3);
  assert.equal(index.filter((i) => i.kind === 'creator').length, 2);
  assert.equal(index.filter((i) => i.kind === 'tag').length, 2);
  assert.equal(index.find((i) => i.id === 'x3').nsfw, true);
  assert.equal(index.find((i) => i.kind === 'animation' && i.id === 'x1').href, 'animations/x1/');
});

test('searchIndex：精确 > 前缀 > 包含；空查询给前 N 个', () => {
  const items = [
    { kind: 'animation', id: 'a', title: '赛博', subtitle: '', keywords: '' },
    { kind: 'animation', id: 'b', title: '赛博霓虹', subtitle: '', keywords: '' },
    { kind: 'animation', id: 'c', title: '霓虹赛博', subtitle: '', keywords: '' },
  ];
  assert.deepEqual(searchIndex(items, '赛博').map((i) => i.id), ['a', 'b', 'c']);
  assert.deepEqual(searchIndex(items, '').map((i) => i.id), ['a', 'b', 'c']);
  assert.equal(searchIndex(items, '').length, 3);
  assert.deepEqual(searchIndex(items, '不存在'), []);
  assert.equal(searchIndex(items, '', 2).length, 2);
});

/* ───────────────────────── 目录读取的回退顺序 ───────────────────────── */

/** 造一个假的 fetch：按 URL 给出响应，并记录请求顺序。 */
function fakeFetch(routes, log = []) {
  return async (url) => {
    log.push(String(url));
    const hit = routes.find(([matcher]) => String(url).includes(matcher));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    if (hit[2] === 'throw') throw new Error('网络断了');
    return { ok: true, status: 200, json: async () => hit[1] };
  };
}

test('loadCatalog：第一个源可用就用它（raw 优先）', async () => {
  const log = [];
  const entries = [{ id: 'only', name: 'A' }];
  const res = await loadCatalog(fakeFetch([['raw.githubusercontent', entries]], log));
  assert.deepEqual(res.entries, entries);
  assert.equal(res.url, 'GitHub raw');
  assert.equal(log.length, 1);
});

test('loadCatalog：raw 挂了退到 jsDelivr，**不竞速**（顺序固定）', async () => {
  const log = [];
  const res = await loadCatalog(fakeFetch([
    ['raw.githubusercontent', null, 'throw'],
    ['jsdelivr', [{ id: 'a' }]],
  ], log));
  assert.equal(res.url, 'jsDelivr CDN');
  assert.equal(log[0].includes('raw.githubusercontent'), true);
  assert.equal(log[1].includes('jsdelivr'), true);
});

test('loadCatalog：远端都不是数组也算失败，继续往下试', async () => {
  const res = await loadCatalog(fakeFetch([
    ['raw.githubusercontent', { not: 'array' }],
    ['jsdelivr', [{ id: 'b' }]],
  ]));
  assert.deepEqual(res.entries, [{ id: 'b' }]);
});

test('loadCatalog：全失败时抛出，错误信息里带上每个源的原因', async () => {
  await assert.rejects(
    () => loadCatalog(fakeFetch([])),
    (err) => {
      assert.equal(err.message.includes('目录取不到'), true);
      assert.equal(err.message.includes('raw.githubusercontent'), true);
      assert.equal(err.message.includes('jsdelivr'), true);
      return true;
    },
  );
});

test('catalogSources：两个源的顺序是 raw 在前（防止过期 CDN 缓存赢）', () => {
  const sources = catalogSources();
  assert.equal(sources.length, 2);
  assert.equal(sources[0].includes('raw.githubusercontent.com'), true);
  assert.equal(sources[1].includes('cdn.jsdelivr.net'), true);
});
