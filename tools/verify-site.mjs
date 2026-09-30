/**
 * verify-site.mjs — 生成后的站点自检。零依赖，只读文件。
 *
 * 它检查的是"这个站真的能用"这件事，而不是"生成器没报错"：
 *   1. 每个页面都有 title / description / canonical / og:title / data-page；
 *   2. 页面里所有站内链接与资源都指向**真实存在**的文件（坏链检查）；
 *   3. 每个 data/index.json 里的条目都有对应的详情页；
 *   4. sitemap.xml 覆盖了所有页面，robots.txt 指向它；
 *   5. 没有伪造统计（下载量/用户数/评分）——这是我们明令禁止的；
 *   6. 文档里没有把软件说成"改开机画面/碰引导"（事实红线）。
 *
 * 用法：node tools/verify-site.mjs
 * 退出码非 0 = 有问题，会逐条列出来。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const DOCS = join(REPO_ROOT, 'docs');

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);

/* ── 收集所有页面 ── */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

const pages = walk(DOCS);
if (!pages.length) fail('docs/ 下没有任何 .html —— 生成器没跑？');

const rel = (p) => p.slice(DOCS.length + 1).replace(/\\/g, '/');

/* ── 1. 每页的基本元信息 ── */
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const name = rel(page);
  const one = (re) => (html.match(re) || []).length;

  if (one(/<title>[^<]*<\/title>/g) !== 1) fail(`${name}: <title> 不是恰好一个`);
  if (!/<meta name="description" content="[^"]+"/.test(html)) fail(`${name}: 缺 meta description`);
  if (!/<link rel="canonical" href="[^"]+"/.test(html)) fail(`${name}: 缺 canonical`);
  if (!/<meta property="og:title"/.test(html)) fail(`${name}: 缺 og:title`);
  if (!/<body[^>]*data-page="/.test(html)) fail(`${name}: body 上没有 data-page（app.js 会认不出这一页）`);
  if (!/<main id="ba-main">/.test(html)) fail(`${name}: 缺 <main id="ba-main">（app.js 的错误兜底依赖它）`);
  if (!/assets\/js\/app\.js/.test(html)) fail(`${name}: 没有引入站点入口脚本`);
  if (name === '404.html' && !/<base href=/.test(html)) fail('404.html: 需要 <base> 才能在任意深度的 URL 下正确链接');
}

/* ── 2. 坏链 + 资源检查 ── */
const SKIP_SCHEME = /^(https?:|mailto:|tel:|data:|javascript:|#)/i;

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const name = rel(page);
  const pageDir = dirname(page);

  // <base href> 会改变相对链接的解析基准
  const baseMatch = /<base href="([^"]+)"/.exec(html);
  if (baseMatch) {
    // 有 base 时只检查带 base 的页面本身是否存在（其链接指向站点根，无法在本地文件系统一一映射）
    notes.push(`${name}: 使用 <base href="${baseMatch[1]}">（404 页特有，跳过相对链接检查）`);
    continue;
  }

  const refs = [];
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) refs.push(m[1]);
  for (const raw of refs) {
    if (SKIP_SCHEME.test(raw) || raw === '') continue;
    const clean = raw.split('#')[0].split('?')[0];
    if (!clean) continue;

    const target = resolve(pageDir, clean);
    const exists = existsSync(target)
      || (existsSync(target) && statSync(target).isDirectory() && existsSync(join(target, 'index.html')))
      || (existsSync(join(target, 'index.html')));

    if (!exists) fail(`${name}: 坏链 ${raw}`);
  }
}

/* ── 3. 每条动画都要有详情页 ── */
let entries = [];
try {
  entries = JSON.parse(readFileSync(join(REPO_ROOT, 'data', 'index.json'), 'utf8'));
} catch (error) {
  fail(`data/index.json 读不了：${error.message}`);
}

for (const e of entries) {
  const p = join(DOCS, 'animations', e.id, 'index.html');
  if (!existsSync(p)) fail(`动画 ${e.id} 没有详情页`);
  else {
    const html = readFileSync(p, 'utf8');
    if (!html.includes(`data-animation-id="${e.id}"`)) fail(`动画 ${e.id} 的详情页缺少 data-animation-id`);
    if (e.preview && !html.includes(e.preview)) fail(`动画 ${e.id} 的详情页没有引用预览图`);
  }
  if (!e.sha256 || !/^[0-9a-f]{64}$/.test(String(e.sha256))) {
    notes.push(`动画 ${e.id} 的 sha256 不是 64 位小写十六进制（客户端会拒绝安装，建议让机器人重算）`);
  }
}
if (!entries.length) notes.push('目录是空的（0 条）—— 空态页面已就位，但社区还没有内容');

/* ── 4. sitemap / robots ── */
const sitemapPath = join(DOCS, 'sitemap.xml');
if (!existsSync(sitemapPath)) fail('缺 sitemap.xml');
else {
  const sm = readFileSync(sitemapPath, 'utf8');
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const expected = pages.length - 1; // 不含 404
  if (locs.length !== expected) fail(`sitemap.xml 有 ${locs.length} 条，页面有 ${expected} 个（不含 404）`);
  if (!sm.includes('<urlset')) fail('sitemap.xml 结构不对');
}
const robotsPath = join(DOCS, 'robots.txt');
if (!existsSync(robotsPath)) fail('缺 robots.txt');
else if (!readFileSync(robotsPath, 'utf8').includes('Sitemap:')) fail('robots.txt 没有指向 sitemap');

/* ── 5. 不许伪造统计 ── */
const FAKE = [
  /\b\d[\d,.]*\s*[KkMm]\+?\s*(downloads?|users?|installs?)/i,
  /\b\d[\d,.]*\s*(万|亿)?\s*(次下载|下载量|用户|使用者)\b/,
  /\b\d{1,3}(\.\d+)?\s*%\s*(好评|满意|评分|rating)/i,
  /\b\d[\d,.]*\s*(stars?|星标)\b/i,
];
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  for (const re of FAKE) {
    const hit = re.exec(html);
    if (hit) fail(`${rel(page)}: 疑似伪造统计「${hit[0].trim()}」`);
  }
}

/* ── 6. 事实红线：不许把软件**说成**改开机画面/碰引导 ──
   注意必须区分"断言"与"否认"：本站到处都在写「不改开机画面、不碰引导」，
   还有 FAQ 里「会不会改我的开机徽标」这种提问。所以逐句判断：
   句子里有否定词（不/非/无/没/未/别/否/问）或以问号结尾的，不算违规。 */
const BANNED_CLAIM = [
  { re: /(修改|替换|更改|改)[^。<]{0,12}(开机画面|启动画面|开机徽标|boot logo)/i, why: '把软件说成改开机画面' },
  { re: /(绕过|关闭|修改)[^。<]{0,10}(Secure Boot|安全启动)/i, why: '声称与 Secure Boot 有关' },
  { re: /(BitLocker)[^。<]{0,12}(解密|关闭|密钥)/i, why: '声称与 BitLocker 有关' },
];
const NEGATION = /[不非无没未别否]/;

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  // 粗略切句：按中文句末标点与换行切开，再逐句判断
  const sentences = html.split(/[。！？\n]+/).map((s) => s.replace(/<[^>]+>/g, ''));
  for (const sentence of sentences) {
    const isQuestion = /[？?]|吗|呢/.test(sentence); // 中文问句未必带问号（"…吗"）
    for (const { re, why } of BANNED_CLAIM) {
      const hit = re.exec(sentence);
      if (!hit) continue;
      if (isQuestion || NEGATION.test(sentence)) continue; // 提问或否认，不算违规
      fail(`${rel(page)}: 事实红线 —— ${why}（「${sentence.trim().slice(0, 60)}」）`);
    }
  }
}

/* ── 7. 关键资源存在 ── */
for (const asset of [
  'assets/css/tokens.css', 'assets/css/base.css', 'assets/css/components.css',
  'assets/js/app.js', 'assets/js/config.js', 'assets/js/catalog.js', 'assets/js/repository.js',
  'assets/data/site-index.json', 'assets/favicon.svg',
  'assets/js/pages/animations.js', 'assets/js/pages/detail.js', 'assets/js/pages/home.js',
  'assets/js/pages/download.js', 'assets/js/pages/community.js', 'assets/js/pages/creators.js',
  'assets/js/pages/creator.js', 'assets/js/ui/dom.js', 'assets/js/ui/video.js',
  'assets/js/ui/card.js', 'assets/js/ui/nav.js', 'assets/js/ui/search.js', 'assets/js/ui/submit-wizard.js',
]) {
  if (!existsSync(join(DOCS, asset))) fail(`缺资源 ${asset}`);
}

/* ── 8. 标题层级：第一个必须是 h1、h1 恰好一个、不许跳级 ──
   这一条是补的：曾经动画库页 h1 直接跳到 h3（卡片标题），作者页更糟 ——
   JS 跑起来会把 h1 一起抹掉。层级乱了读屏用户会失去页面结构的线索。 */
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const name = rel(page);
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  if (!levels.length) {
    fail(`${name}: 一个标题标签都没有`);
    continue;
  }
  if (levels[0] !== 1) fail(`${name}: 第一个标题是 h${levels[0]}，应为 h1`);
  const h1Count = levels.filter((l) => l === 1).length;
  if (h1Count !== 1) fail(`${name}: h1 有 ${h1Count} 个（应为 1）`);
  let prev = 0;
  for (const level of levels) {
    if (prev && level > prev + 1) fail(`${name}: 标题层级从 h${prev} 跳到 h${level}`);
    prev = level;
  }
}

/* ── 输出 ── */
console.log(`页面 ${pages.length} 个 · 目录 ${entries.length} 条`);
if (notes.length) {
  console.log('\n提示（不是错误）：');
  for (const n of notes) console.log('  · ' + n);
}
if (problems.length) {
  console.log(`\n发现 ${problems.length} 个问题：`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exitCode = 1;
} else {
  console.log('\n✅ 全部检查通过：元信息齐全、没有坏链、无伪造统计、事实红线未触碰。');
}
