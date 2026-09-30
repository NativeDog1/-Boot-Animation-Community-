// 本地预览用的小静态服务器（只用于开发；线上是 GitHub Pages）。
//
//   node serve.mjs          → http://127.0.0.1:8123
//
// 它刻意复刻 GitHub Pages 的两个行为，这样本地看到的就是线上的样子：
//   1. 站点根 = docs/（Pages 从这里发布）；
//   2. 目录地址（/animations）自动落到 /animations/index.html —— 线上就是这个行为，
//      也是「刷新不 404」能成立的原因（每个路由都是真文件）。
// 另外把仓库根的 /data/ 也挂上，这样本地也能读到真实的 data/index.json
// （线上读的是 raw.githubusercontent，因为 Pages 只发布 docs/）。
//
// 注意：直接双击 index.html 用 file:// 打开会失败 —— 浏览器会以 null 源发起 fetch，
// CORS 会拦掉。所以本地看页面要走这个服务器。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// 注意：目录 URL 转出来会带尾部分隔符，而 join() 的结果不会 —— 去掉它，
// 否则下面的 startsWith 防护在站点根（'/'）上恒为假，首页会被当成 404。
const DOCS = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\/]+$/, '');
const REPO_ROOT = dirname(DOCS);
const PORT = Number(process.env.PORT || 8123);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
};

async function tryFile(path) {
  try {
    const s = await stat(path);
    return s.isFile() ? path : null;
  } catch {
    return null;
  }
}

async function resolve(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  // 仓库根的 data/ 也对外（仅本地；线上不存在这个前缀）
  const base = rel.startsWith('data/') ? REPO_ROOT : DOCS;
  const target = join(base, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  // 目录穿越防护：必须刚好等于 base，或落在 base 之内
  if (target !== base && !target.startsWith(base + sep)) return null;

  const direct = await tryFile(target);
  if (direct) return direct;
  if (!extname(target)) {
    const index = await tryFile(join(target, 'index.html'));
    if (index) return index;
    if (rel === '' || rel === '/') return tryFile(join(DOCS, 'index.html'));
  }
  return null;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const file = await resolve(url.pathname);
    if (!file) {
      const notFound = await tryFile(join(DOCS, '404.html'));
      const body = notFound ? await readFile(notFound) : Buffer.from('404 not found');
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end(String(error));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`  本地预览: http://127.0.0.1:${PORT}`);
});
