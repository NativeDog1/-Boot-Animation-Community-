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
import { planParts, manifestOf, partsHint, DEFAULT_PART_BYTES, ATTACH_LIMIT, fitsOneIssue, MAX_PARTS_PER_ISSUE } from '../lib/split.js';
import { sha256OfBlob } from '../lib/sha256.js';

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
  // 大文件（尤其是 4K 原画）的专用提示：> 10 MB 就没法拖进 Issue 表单了
  const bigHint = el('div', { class: 'callout callout--warn', hidden: true, style: 'margin-top:12px' });

  // 直链输入：把视频传到自己仓库的 Release 之后，把链接粘这里，表单会自动带上
  const linkInput = el('input', {
    class: 'input',
    type: 'url',
    placeholder: 'https://github.com/你/仓库/releases/download/v1/xxx.mp4',
    'aria-label': '视频直链（可选）',
  });
  const linkField = el('div', { class: 'field', style: 'margin-top:10px' }, [
    el('span', { class: 'field__label', text: '视频直链（可选 · 大于 10 MB 时贴这里）' }),
    linkInput,
    el('span', {
      class: 'field__hint',
      text: '贴一个能直接下载的 https 链接就行 —— 临时的也可以。机器人会把它搬进社区仓库长期托管，所以你的链接不需要长期有效，也不需要你有 GitHub 仓库。',
    }),
  ]);

  // 分片模式：不需要仓库、不需要网盘 —— 在浏览器里切好，分片一起拖进表单就行
  const splitBtn = el('button', { class: 'btn btn--primary', type: 'button', text: '切成附件分片（不需要网盘/仓库）' });
  const splitStatus = el('p', { class: 'muted small', style: 'margin-top:8px' });
  const splitField = el('div', { class: 'stack stack--tight', style: 'margin-top:12px', hidden: true }, [
    el('span', { class: 'field__label', text: '文件太大拖不进表单？让我把它切成 20 MB 的分片' }),
    splitBtn,
    splitStatus,
  ]);

  // ── 路线开关：文件超过 10 MB 时，拖不进表单，让用户明确二选一 ──
  const routeSplitBtn = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', text: '切成附件分片（不需要外部托管）' });
  const routeLinkBtn = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', text: '我贴一个链接（机器人代管）' });
  const routeSwitch = el('div', { style: 'margin-top:12px', hidden: true }, [
    el('span', { class: 'field__label', text: '文件超过 10 MB，选一种交给我' }),
    el('div', { class: 'chips', style: 'margin-top:6px' }, [routeSplitBtn, routeLinkBtn]),
  ]);

  /** 切换"切分片 / 贴链接"两条路。默认切分片：它不需要任何外部托管。 */
  function setRoute(route) {
    const isSplit = route !== 'link';
    if (state) state.route = isSplit ? 'split' : 'link';
    splitField.hidden = !isSplit;
    linkField.hidden = isSplit;
    routeSplitBtn.setAttribute('aria-pressed', isSplit ? 'true' : 'false');
    routeLinkBtn.setAttribute('aria-pressed', isSplit ? 'false' : 'true');
  }
  routeSplitBtn.addEventListener('click', () => setRoute('split'));
  routeLinkBtn.addEventListener('click', () => setRoute('link'));

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
        text: '点下面的按钮打开投稿表单（名称已帮你预填）。≤ 10 MB 就在表单里把同一个文件拖进「视频」框；更大的文件把直链粘到下面，我会一起填进表单 —— 上传和托管都由机器人接手。',
      }),
      routeSwitch,
      linkField,
      bigHint,
      splitField,
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
        // 分片投稿：清单由切分流程生成，直接填进表单，用户不用手抄
        parts: (state && state.partsManifest) || '',
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

  /* ── 把大文件切成附件分片 ──
     这是"只拖一次"的关键：不需要仓库、不需要网盘，浏览器里切好之后
     用户把 N 个分片一起拖进表单，机器人按 sha256 拼回并校验。 */
  splitBtn.addEventListener('click', async () => {
    const file = input.files && input.files[0];
    if (!file) { toast('先在第 1 步选一个视频文件', 'err'); return; }
    splitBtn.disabled = true;
    try {
      splitStatus.textContent = '正在计算校验值（流式读取，不会把文件整个读进内存）…';
      const sha256 = await sha256OfBlob(file, {
        onProgress: (done, total) => {
          splitStatus.textContent = '正在计算校验值… ' + Math.round((done / total) * 100) + '%';
        },
      });

      const parts = planParts(file.size, DEFAULT_PART_BYTES, file.name);
      splitStatus.textContent = '准备写入 ' + parts.length + ' 个分片…';

      // 首选一次选好文件夹（Chrome/Edge 支持），只弹一个对话框；
      // 不支持就退回逐个下载，用户会在下载目录里拿到这些文件。
      let dir = null;
      if (typeof window.showDirectoryPicker === 'function') {
        try {
          dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'ba-parts', startIn: 'downloads' });
        } catch { dir = null; }
      }

      for (const part of parts) {
        const blob = file.slice(part.start, part.end);
        if (dir) {
          const handle = await dir.getFileHandle(part.name, { create: true });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
        } else {
          const url = URL.createObjectURL(blob);
          const a = el('a', { href: url, download: part.name });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          await new Promise((r) => setTimeout(r, 250));   // 别把浏览器的连续下载挤掉
        }
        splitStatus.textContent = '已写入 ' + part.index + '/' + parts.length + ' 个分片…';
      }

      state.partsManifest = manifestOf({
        name: file.name,
        bytes: file.size,
        parts: parts.length,
        partBytes: DEFAULT_PART_BYTES,
        sha256,
      });
      applySubmitUrl();
      splitStatus.textContent = partsHint(parts, file.size)
        + (dir ? '（已写入你选的文件夹）' : '（已逐个保存到下载目录）')
        + ' 分片信息已自动填进表单，你不用手抄。';
    } catch (error) {
      splitStatus.textContent = '切分失败：' + (error && error.message ? error.message : error);
    } finally {
      splitBtn.disabled = false;
    }
  });

  /* 超过这个体积就不在浏览器里算 sha256 了：WebCrypto 要把整个文件读进内存，
     几百 MB 会直接把标签页拖死甚至崩掉。机器人本来就会自己下载后重算，所以
     跳过它不影响上架 —— 只是"我帮你算好了"这个便利在大文件上让位给"别把浏览器搞崩"。 */
  const SKIP_HASH_ABOVE = 64 * 1024 * 1024;

  async function handleFile(file) {
    state = {
      fileName: file.name,
      name: file.name.replace(/\.[^.]+$/, ''),
      meta: null,
      partsManifest: '',
      route: (state && state.route) || 'link',   // 默认走链接：大文件切分片装不下
    };
    splitStatus.textContent = '';
    splitBtn.disabled = false;
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

      const tooBig = file.size > ATTACH_LIMIT;
      const canSplit = fitsOneIssue(file.size);
      bigHint.hidden = !tooBig;
      routeSwitch.hidden = !tooBig;
      if (!tooBig) {
        // 小文件：直接拖进表单最省事；链接框留着给"手上只有链接"的人
        linkField.hidden = false;
        splitField.hidden = true;
      } else {
        // 大文件：默认走链接（机器人代管）。切分片只在一条 Issue 装得下时可用。
        setRoute(canSplit ? (state.route || 'link') : 'link');
      }
      routeSplitBtn.disabled = !canSplit;
      routeSplitBtn.title = canSplit ? ''
        : '这个文件太大：一条 Issue 最多带 ' + MAX_PARTS_PER_ISSUE + ' 个附件，切分片也装不下（约 '
          + Math.round((DEFAULT_PART_BYTES * MAX_PARTS_PER_ISSUE) / 1048576) + ' MB 上限）。请用链接。';
      if (tooBig) {
        bigHint.replaceChildren(
          el('div', {}, [
            el('b', { text: '这个文件超过 10 MB，GitHub 的表单装不下它。' }),
            el('p', { class: 'small', style: 'margin:6px 0 0', text: '「我贴一个链接」：把视频放到任何能直接下载的地方（自己的 Releases、对象存储、网盘给的临时直链都行），把链接粘进下面的框 —— 机器人会立刻把它搬进社区仓库长期托管，所以那个链接只需要在它下载的几分钟里有效。你不需要有仓库或 Release。' }),
            el('p', { class: 'small', style: 'margin:6px 0 0', text: '「切成附件分片」：适合 10–90 MB 的文件 —— 我把它切成 9 MB 一块写进你选的文件夹，你把它们一起拖进表单，分片信息自动填好。' }),
            canSplit ? null : el('p', { class: 'small', style: 'margin:6px 0 0', text: '⚠️ 你这个文件已经超出"切分片"能承受的范围（一条 Issue 最多 10 个附件 × 9 MB），所以只能走链接。' }),
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
