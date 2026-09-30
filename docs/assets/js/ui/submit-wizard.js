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
  // 大文件（尤其是 4K 原画）的专用提示：> 25 MB 就没法拖进 Issue 表单了
  const bigHint = el('div', { class: 'callout callout--warn', hidden: true, style: 'margin-top:12px' });

  // 直链输入：把视频传到自己仓库的 Release 之后，把链接粘这里，表单会自动带上
  const linkInput = el('input', {
    class: 'input',
    type: 'url',
    placeholder: 'https://github.com/你/仓库/releases/download/v1/xxx.mp4',
    'aria-label': '视频直链（可选）',
  });
  const linkField = el('div', { class: 'field', style: 'margin-top:10px' }, [
    el('span', { class: 'field__label', text: '视频直链（可选 · 大于 25 MB 时用这条路）' }),
    linkInput,
    el('span', {
      class: 'field__hint',
      text: '把视频上传到你自己的 GitHub Release，然后把那个文件的直链粘到这里 —— 点上面的按钮时我会把它一起填进投稿表单。没有仓库也可以用任何稳定的 https 直链。',
    }),
  ]);

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
      'sha256：' + (m.sha256 || '（文件较大，未在浏览器端计算）'),
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
        text: '点下面的按钮打开投稿表单（名称已帮你预填）。≤ 25 MB 就在表单里把同一个文件拖进「视频」框；更大的文件请先传到自己的 Releases，再把直链粘到下面。',
      }),
      linkField,
      bigHint,
      el('div', { class: 'btn-row' }, [submitLink, copyBtn]),
    ]),
  );

  dialog.append(head, body);
  document.body.append(dialog);
  dialog.addEventListener('close', () => { if (drop) drop.style.borderColor = 'var(--line-strong)'; });

  /** 依当前状态（名称 + 直链）重算投稿表单地址。 */
  function applySubmitUrl() {
    const link = (linkInput.value || '').trim();
    const linkOk = !link || /^https:\/\/\S+$/i.test(link);
    const name = (state && state.name) || '';
    submitLink.href = linkOk
      ? submitIssueUrl({
        name,
        slug: suggestSlug(name) || 'my-animation',
        video: link,
        license: '',
        nsfw: 'false',
        tags: '',
        description: '',
      })
      : '#';
    submitLink.setAttribute('aria-disabled', linkOk ? 'false' : 'true');
    if (!linkOk) {
      linkInput.style.borderColor = 'var(--danger)';
      linkInput.title = '要以 https:// 开头的直链（网盘分享页不行）';
    } else {
      linkInput.style.borderColor = '';
      linkInput.title = '';
    }
  }
  linkInput.addEventListener('input', applySubmitUrl);
  applySubmitUrl();   // 打开向导时先给一个有效地址，用户点「打开表单」总能到地方

  /* 超过这个体积就不在浏览器里算 sha256 了：WebCrypto 要把整个文件读进内存，
     几百 MB 会直接把标签页拖死甚至崩掉。机器人本来就会自己下载后重算，所以
     跳过它不影响上架 —— 只是"我帮你算好了"这个便利在大文件上让位给"别把浏览器搞崩"。 */
  const SKIP_HASH_ABOVE = 64 * 1024 * 1024;

  async function handleFile(file) {
    state = { fileName: file.name, name: file.name.replace(/\.[^.]+$/, ''), meta: null };
    dropText.textContent = file.name;
    progress.hidden = false;
    progress.textContent = `读取 ${file.name} …`;
    clear(result);
    result.append(el('p', { class: 'muted small', text: '正在读取元数据…' }));

    try {
      const meta = await readVideoMeta(file);
      const skipHash = file.size > SKIP_HASH_ABOVE;
      let sha256 = '';
      if (!skipHash) {
        try { sha256 = await sha256OfFile(file); } catch { sha256 = ''; }
      }
      const merged = { ...meta, sha256, bytes: file.size, hashSkipped: skipHash };
      state.meta = merged;
      progress.hidden = true;

      const check = validateLocalFile({ ...meta, bytes: file.size });
      renderResult(merged, check);

      copyBtn.disabled = false;
      applySubmitUrl();

      const MB = 1024 * 1024;
      bigHint.hidden = file.size <= 25 * MB;
      if (!bigHint.hidden) {
        bigHint.replaceChildren(
          el('div', {}, [
            el('b', { text: '这个文件超过 25 MB，不能直接拖进投稿表单。' }),
            el('p', { class: 'small', style: 'margin:6px 0 0', text: 'GitHub 的 Issue 附件上限就是 25 MB。按下面两步走一次，以后同类大文件都这么投：' }),
            el('ol', { class: 'small', style: 'margin:6px 0 0;padding-left:1.2em' }, [
              el('li', { text: '把视频上传到你自己的某个 GitHub 仓库 Releases（单个文件最大 2 GB，免费）：仓库 → Releases → Draft a new release → 把 mp4 拖进附件区。' }),
              el('li', { text: '复制那个文件的链接（形如 https://github.com/你/仓库/releases/download/v1/xxx.mp4），粘到上面的「视频直链」框里。' }),
            ]),
            el('p', { class: 'small', style: 'margin:6px 0 0', text: '没有自己的仓库也行，任何稳定的 https 直链都可以；网盘分享页不行（机器人要能直接下到文件本体）。' }),
            el('p', { class: 'small', style: 'margin:6px 0 0', text: '💡 建议再单独投一版 1440p（约 10 MB）：客户端会自动断点续传，但大文件终究要等，而多数人只想要一个几秒就能装好的片头。' }),
          ]),
        );
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
      ['sha256', meta.sha256 || '文件较大，浏览器端跳过 —— 机器人下载后会自己算'],
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
