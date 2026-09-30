/**
 * submit-wizard.js — 投稿向导。**把旧版 docs/app.js 里那套浏览端向导完整搬过来**，
 * 行为一字不改：选文件 → 本地算 sha256 + 抽预览帧 + 校验 → 打开预填好的 GitHub 表单。
 *
 * 它存在的意义：投稿的"机器能算的"（哈希、分辨率、时长、体积、预览图）**都不让用户填**。
 * 用户只负责提供视频和名字，剩下的由浏览器和机器人完成。
 */
import { el, icon, toast, copyText, clear } from './dom.js';
import {
  formatBytes, formatDuration, suggestSlug, validateLocalFile, sha256OfFile, readVideoMeta, submitIssueUrl,
} from '../catalog.js';

let dialog = null;
let state = null;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = el('dialog', { class: 'modal', id: 'ba-wizard', 'aria-label': '投稿开机动画' });

  const head = el('div', { class: 'modal__head' }, [
    el('h2', { class: 'modal__title', text: '投稿开机动画' }),
  ]);
  const closeBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭' });
  const ci = icon('close', 16);
  if (ci) closeBtn.append(ci);
  closeBtn.addEventListener('click', () => dialog.close());
  head.append(closeBtn);

  const body = el('div', { class: 'modal__body' });
  body.append(el('p', {
    class: 'muted small',
    text: '全程在你这台电脑上完成 —— 视频不会经过我们，这个站也没有服务器。',
  }));

  /* ── 步骤 1：选文件 ── */
  const dropText = el('span', { text: '点击选择，或把视频拖到这里' });
  const input = el('input', { type: 'file', accept: 'video/mp4,video/*', hidden: true, id: 'ba-wiz-file' });
  const progress = el('p', { class: 'muted small', hidden: true });
  const drop = el('div', {
    class: 'drop', tabindex: '0', role: 'button',
    style: 'margin-top:8px;padding:26px 16px;border:1.5px dashed var(--line-strong);border-radius:var(--r-2);text-align:center;color:var(--fg-2);cursor:pointer',
  }, [input, dropText]);

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.style.borderColor = 'var(--brand)';
    drop.style.background = 'var(--brand-dim)';
  });
  drop.addEventListener('dragleave', () => {
    drop.style.borderColor = 'var(--line-strong)';
    drop.style.background = '';
  });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.style.borderColor = 'var(--line-strong)';
    drop.style.background = '';
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    if (f) handleFile(f);
  });

  const result = el('div', { id: 'ba-wiz-result', style: 'margin-top:12px' }, [
    el('p', { class: 'muted small', text: '还没选文件。' }),
  ]);
  const bigHint = el('p', { class: 'muted small', hidden: true });

  const submitLink = el('a', { class: 'btn btn--primary', href: '#', target: '_blank', rel: 'noopener', 'aria-disabled': 'true' });
  submitLink.append(document.createTextNode('打开 GitHub 投稿表单'));
  submitLink.addEventListener('click', (e) => { if (submitLink.getAttribute('aria-disabled') === 'true') e.preventDefault(); });
  const copyBtn = el('button', { class: 'btn', type: 'button', text: '复制我算好的信息', disabled: true });
  copyBtn.addEventListener('click', async () => {
    if (!state || !state.meta) return;
    const m = state.meta;
    const text = [
      '名称：' + (state.name || ''),
      '文件：' + (state.fileName || ''),
      '分辨率：' + (m.width ? m.width + '×' + m.height : '—'),
      '时长：' + (m.duration ? m.duration.toFixed(2) + ' 秒' : '—'),
      '体积：' + m.bytes + ' 字节',
      'sha256：' + m.sha256,
    ].join('\n');
    toast(await copyText(text) ? '已复制，粘贴到 GitHub 表单里就行' : '复制失败，请手动选中复制', 'err');
  });

  body.append(
    el('section', { style: 'margin-top:20px' }, [el('h3', { text: '1 · 选一个 mp4' }), drop, progress]),
    el('section', { style: 'margin-top:20px' }, [el('h3', { text: '2 · 检查结果' }), result]),
    el('section', { style: 'margin-top:20px' }, [
      el('h3', { text: '3 · 去 GitHub 提交' }),
      el('p', {
        class: 'muted small',
        text: '点下面的按钮打开投稿表单（名称已帮你预填）。然后在表单里把同一个视频文件直接拖进「视频」那个文本框 —— GitHub 会自己托管它，链接会自动填好，你连 sha256 都不用算。',
      }),
      bigHint,
      el('div', { class: 'btn-row' }, [submitLink, copyBtn]),
    ]),
  );

  dialog.append(head, body);
  document.body.append(dialog);
  dialog.addEventListener('close', () => { if (drop) drop.style.borderColor = 'var(--line-strong)'; });

  async function handleFile(file) {
    state = { fileName: file.name, name: file.name.replace(/\.[^.]+$/, ''), meta: null };
    dropText.textContent = file.name;
    progress.hidden = false;
    progress.textContent = `读取 ${file.name} …`;
    clear(result);
    result.append(el('p', { class: 'muted small', text: '正在读取元数据并计算 sha256（大文件要几秒）…' }));

    try {
      const meta = await readVideoMeta(file);
      const sha256 = await sha256OfFile(file);
      const merged = { ...meta, sha256, bytes: file.size };
      state.meta = merged;
      progress.hidden = true;

      const check = validateLocalFile({ ...meta, bytes: file.size });
      renderResult(merged, check);

      const slug = suggestSlug(state.name) || 'my-animation';
      submitLink.href = submitIssueUrl({
        name: state.name,
        slug,
        video: '',
        license: '',
        nsfw: 'false',
        tags: '',
        description: '',
      });
      submitLink.setAttribute('aria-disabled', 'false');
      copyBtn.disabled = false;

      bigHint.hidden = file.size <= 25 * 1024 * 1024;
      if (!bigHint.hidden) {
        bigHint.textContent = '⚠️ 文件超过 25 MB —— GitHub 的 Issue 附件装不下。这种文件必须走 Releases，把直链贴进表单。文件越大，用户下载越容易中途断掉，建议压到 30 MB 以内（1440p 通常约 10 MB）。';
      }
    } catch (error) {
      progress.hidden = true;
      clear(result);
      result.append(el('div', { class: 'callout callout--danger' }, [
        el('span', { text: '读不了这个文件：' + (error && error.message ? error.message : String(error)) + '。确认它是标准 mp4。' }),
      ]));
      submitLink.setAttribute('aria-disabled', 'true');
      copyBtn.disabled = true;
    }
  }

  function renderResult(meta, check) {
    clear(result);
    const card = el('div', { style: 'display:grid;grid-template-columns:200px 1fr;gap:14px;align-items:start' });
    if (meta.previewDataUrl) {
      const img = el('img', {
        src: meta.previewDataUrl, alt: '',
        style: 'width:100%;border-radius:var(--r-2);border:1px solid var(--line)',
      });
      card.append(img);
    } else {
      card.append(el('div', { class: 'thumb-fallback', style: 'position:static;border-radius:var(--r-2);min-height:110px' }, [
        el('span', { text: '抽帧失败（不影响投稿）' }),
      ]));
    }

    const facts = el('dl', { class: 'facts' });
    const rows = [
      ['分辨率', meta.width ? `${meta.width}×${meta.height}` : '—'],
      ['时长', meta.duration ? formatDuration(meta.duration) : '—'],
      ['体积', formatBytes(meta.bytes)],
      ['sha256', meta.sha256],
    ];
    for (const [k, v] of rows) {
      facts.append(el('dt', { text: k }));
      facts.append(el('dd', { text: v, style: k === 'sha256' ? 'font-family:var(--mono);font-size:var(--t-xs);word-break:break-all' : '' }));
    }
    card.append(facts);
    result.append(card);

    if (check.issues.length) {
      const box = el('div', { class: 'callout callout--danger', style: 'margin-top:12px' });
      const ul = el('ul', { style: 'margin:0;padding-left:1.2em' });
      for (const x of check.issues) ul.append(el('li', { text: x }));
      box.append(el('div', {}, [el('b', { text: '不能提交：' }), ul]));
      result.append(box);
    }
    if (check.warn.length) {
      const box = el('div', { class: 'callout callout--warn', style: 'margin-top:12px' });
      const ul = el('ul', { style: 'margin:0;padding-left:1.2em' });
      for (const x of check.warn) ul.append(el('li', { text: x }));
      box.append(el('div', {}, [el('b', { text: '可以提交，但建议改：' }), ul]));
      result.append(box);
    }
    if (check.ok && !check.warn.length) {
      result.append(el('div', { class: 'callout callout--ok', style: 'margin-top:12px' }, [
        el('span', { text: '检查通过 —— 继续第 3 步。' }),
      ]));
    }
  }

  return dialog;
}

/** 打开向导。任何页面都能调。 */
export function openWizard() {
  const d = ensureDialog();
  if (!d.open) d.showModal();
  return d;
}
