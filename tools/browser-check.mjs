/**
 * browser-check.mjs — 零依赖的浏览器检查（Edge/Chrome + CDP）。
 *
 * 为什么需要它：`--dump-dom` 只能看"加载后的 DOM"，点不了按钮、也拿不到 console 错误。
 * 而投稿向导这类交互只有真的点开才能验证。这里用 Node 内置的 WebSocket 直接连
 * DevTools 协议，不装任何依赖。
 *
 * 用法：
 *   node tools/browser-check.mjs <url> [选项]
 *     --click <选择器>     加载后点击它（可重复）
 *     --eval <表达式>      再求值一段 JS（可重复）
 *     --dump <选择器>      打印该元素的 outerHTML（截断 1200 字）
 *     --wait <毫秒>        每个动作之间的等待，默认 900
 *     --json               只输出 JSON 结果
 *
 * 退出码：0 = 没有 console 错误、没有未捕获异常；1 = 有。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--'));
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : (i >= 0 ? true : fallback);
};
const all = (name) => argv.reduce((acc, a, i) => (a === name && argv[i + 1] ? [...acc, argv[i + 1]] : acc), []);
const clicks = all('--click');
const evals = all('--eval');
const dumps = all('--dump');
const setFile = flag('--setfile');       // 选择器：往这个 file input 里塞文件
const uploadPath = flag('--upload');     // 要塞进去的本地文件路径
const waitMs = Number(flag('--wait', 900)) || 900;
const jsonOnly = argv.includes('--json');
const port = 9333 + Math.floor(Math.random() * 200);

if (!url) {
  console.error('用法: node tools/browser-check.mjs <url> [--click sel] [--eval expr] [--dump sel]');
  process.exit(2);
}

const browser = EDGE_CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error('找不到 Edge/Chrome');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return res.json();
}

const child = spawn(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), 'ba-cdp-'))}`,
  'about:blank',
], { stdio: 'ignore' });

const result = { url, consoleErrors: [], exceptions: [], logs: [], clicks: {}, evals: [], dumps: {} };

try {
  // 等 DevTools 端口起来
  let targets = null;
  for (let i = 0; i < 60; i += 1) {
    try {
      targets = await http('/json/list');
      if (targets && targets.length) break;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  if (!targets || !targets.length) throw new Error('DevTools 端口没起来');
  const page = targets.find((t) => t.type === 'page') || targets[0];

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg.result ?? msg.error);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
      const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' ');
      (msg.params.type === 'error' ? result.consoleErrors : result.logs).push(text);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      result.exceptions.push(d.exception?.description || d.text || 'unknown');
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const e = msg.params.entry;
      result.consoleErrors.push(`[${e.source}] ${e.text}${e.url ? ' ← ' + e.url : ''}`);
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    msgId += 1;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(waitMs + 600);

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r?.result?.value;
  };

  for (const sel of clicks) {
    result.clicks[sel] = await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'NOT-FOUND'; el.click(); return 'clicked'; })()`,
    );
    await sleep(waitMs);
  }

  // 往 file input 里塞一个真实文件（CDP 的 DOM.setFileInputFiles，会自己触发 change）——
  // 这是唯一能验证「拖进一个大文件之后界面怎么反应」的办法。
  if (setFile && uploadPath) {
    await send('DOM.enable');
    const doc = await send('DOM.getDocument');
    const found = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: setFile });
    if (!found || !found.nodeId) {
      result.uploads = { selector: setFile, state: 'NOT-FOUND' };
    } else {
      const r = await send('DOM.setFileInputFiles', { files: [uploadPath], nodeId: found.nodeId });
      result.uploads = { selector: setFile, state: r && r.error ? `ERROR ${r.error.message}` : 'set', file: uploadPath };
      await sleep(waitMs * 3);   // 读元数据 + 抽帧需要一点时间
    }
  }
  for (const expr of evals) {
    result.evals.push({ expr, value: await evaluate(expr) });
  }
  for (const sel of dumps) {
    const html = await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.outerHTML : 'NOT-FOUND'; })()`,
    );
    result.dumps[sel] = typeof html === 'string' ? html.slice(0, 1200) : html;
  }

  result.title = await evaluate('document.title');
  result.bodyText = String(await evaluate('document.body.innerText.slice(0, 400)') || '');
  ws.close();
} catch (error) {
  result.fatal = String(error && error.message ? error.message : error);
} finally {
  try { child.kill(); } catch { /* 已退出 */ }
}

const bad = result.fatal || result.exceptions.length || result.consoleErrors.length;
if (jsonOnly) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`URL: ${result.url}`);
  console.log(`标题: ${result.title}`);
  if (result.fatal) console.log(`❌ 致命: ${result.fatal}`);
  if (result.exceptions.length) {
    console.log(`❌ 未捕获异常 ${result.exceptions.length} 条:`);
    for (const e of result.exceptions) console.log('   ' + e.split('\n')[0]);
  }
  if (result.consoleErrors.length) {
    console.log(`❌ console 错误 ${result.consoleErrors.length} 条:`);
    for (const e of result.consoleErrors) console.log('   ' + e);
  }
  if (result.logs.length) {
    console.log(`⚠️ console 警告 ${result.logs.length} 条:`);
    for (const e of result.logs) console.log('   ' + e);
  }
  for (const [sel, state] of Object.entries(result.clicks)) console.log(`点击 ${sel} → ${state}`);
  for (const { expr, value } of result.evals) console.log(`求值 ${expr} → ${JSON.stringify(value)}`);
  for (const [sel, html] of Object.entries(result.dumps)) {
    console.log(`\n--- ${sel} ---\n${html}`);
  }
  console.log(bad ? '\n结果：有问题' : '\n结果：✅ 干净（无异常、无 console 错误）');
}
process.exit(bad ? 1 : 0);
