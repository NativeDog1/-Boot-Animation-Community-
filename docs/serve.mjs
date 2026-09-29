// 本地预览用的小静态服务器（只用于开发，线上用 GitHub Pages）。
//
//   node serve.mjs          → http://127.0.0.1:8123
//
// 注意：直接双击 index.html 用 file:// 打开会失败 —— 浏览器会以 null 源发起
// fetch，CORS 会拦掉。所以本地看页面要走这个服务器。
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const PORT = Number(process.env.PORT || 8123)
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    // 防目录穿越
    const target = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''))
    if (!target.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return }
    const body = await readFile(target)
    res.writeHead(200, { 'content-type': TYPES[extname(target)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found')
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`  本地预览: http://127.0.0.1:${PORT}`)
})
