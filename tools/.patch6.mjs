/**
 * 一次性补丁（修正 @@ 用法：@@name} 还原成 ${name}，不要再写 @@{name}）。
 * 处理标题层级问题：侧栏分组标签不该是标题、页脚栏目用 h2 避免跳级、
 * 动画库补一个视觉隐藏的 h2。
 */
import { readFileSync, writeFileSync } from 'node:fs';
const TARGET = new URL('./build-site.mjs', import.meta.url);
const src = readFileSync(TARGET, 'utf8');
const P = (lines) => lines.join('\n');

const patches = [
  {
    label: '动画库：补一个 h2（原来 h1 直接跳 h3）',
    find: P(['    <div id="ba-grid" class="grid">@@cards}</div>@@overflow}']),
    replace: P([
      '    <h2 class="sr-only">动画列表</h2>',
      '    <div id="ba-grid" class="grid">@@cards}</div>@@overflow}',
    ]),
  },
  {
    label: '作者页：保留 h1，列表放进独立容器，补 h2',
    find: P([
      '    <h1>作者</h1>',
      '    <div id="ba-main-inner" hidden></div>',
      '    <div id="ba-creators-note" class="muted small"></div>',
    ]),
    replace: P([
      '    <h1>作者</h1>',
      '    <p class="muted small" id="ba-creators-note"></p>',
      '    <h2 class="sr-only">作者列表</h2>',
      '    <div id="ba-creators-list"></div>',
    ]),
  },
  {
    label: '文档侧栏：分组标签改成非标题元素（它们在 <nav> 里，不参与文档大纲）',
    find: P(['        return `<h4>@@esc(g.label)}</h4><ul>@@items.map((d) => `<li><a href="@@p}docs/@@d.slug}/"@@d.slug === doc.slug ? \' aria-current="page"\' : \'\'}>@@esc(d.title)}</a></li>`).join(\'\')}</ul>`;']),
    replace: P(['        return `<div class="docs-nav__title">@@esc(g.label)}</div><ul>@@items.map((d) => `<li><a href="@@p}docs/@@d.slug}/"@@d.slug === doc.slug ? \' aria-current="page"\' : \'\'}>@@esc(d.title)}</a></li>`).join(\'\')}</ul>`;']),
  },
  {
    label: '页脚：栏目标题 h4 → h2（h4 跟在正文 h2/h3 后面会跳级）',
    find: P(['  const col = (title, items) => `<div class="site-footer__col"><h4>@@title}</h4><ul>@@items']),
    replace: P(['  const col = (title, items) => `<div class="site-footer__col"><h2 class="site-footer__title">@@title}</h2><ul>@@items']),
  },
  {
    label: '页脚：品牌栏标题同样改 h2',
    find: P(['        <h4>@@SITE.name}</h4>']),
    replace: P(['        <h2 class="site-footer__title">@@SITE.name}</h2>']),
  },
];

let out = src;
const failed = [];
for (const p of patches) {
  const find = p.find.replace(/@@/g, '${');
  const replace = p.replace.replace(/@@/g, '${');
  const count = out.split(find).length - 1;
  if (count !== 1) { failed.push(`${p.label}（命中 ${count}）`); continue; }
  out = out.replace(find, replace);
}
if (failed.length) {
  console.error('❌ 未命中，未写入：'); for (const f of failed) console.error('   - ' + f);
  process.exitCode = 1;
} else {
  writeFileSync(TARGET, out, 'utf8');
  console.log(`✅ 已应用 ${patches.length} 处`);
}
