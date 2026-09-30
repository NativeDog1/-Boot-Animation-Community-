import { readFileSync, writeFileSync } from 'node:fs';
const TARGET = new URL('./build-site.mjs', import.meta.url);
const src = readFileSync(TARGET, 'utf8');
const P = (lines) => lines.join('\n');
const patches = [
  {
    label: '动画库：补一个 h2（原来 h1 直接跳 h3）',
    find: P(['    <div id="ba-grid" class="grid">@@{cards}</div>@@{overflow}']),
    replace: P([
      '    <h2 class="sr-only">动画列表</h2>',
      '    <div id="ba-grid" class="grid">@@{cards}</div>@@{overflow}',
    ]),
  },
  {
    label: '作者页：保留 h1，并把列表放进独立容器（原来 JS 会把 h1 一起抹掉）',
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
