/**
 * detail.js — 单个动画的详情页。
 *
 * 静态 HTML 里已经有全部信息（SEO 与禁用 JS 都能看），这个模块负责把它变成可交互的：
 * 点击才加载视频、深链唤起客户端并**检测是否真的唤起了**、复制 sha256、相关推荐。
 *
 * 关于「用开机动画打开」的诚实做法：浏览器无法知道协议有没有注册。所以点了之后
 * 等一小会儿：如果页面**没有失去焦点**，基本可以判定没装客户端 —— 这时给的不是
 * 一句"失败"，而是能继续走的两条路（下载软件 / 直接下载再手动导入）。
 */
import { $, el, icon, toast, copyText, stateBlock } from '../ui/dom.js';
import { posterPlayer } from '../ui/video.js';
import { formatBytes, formatDuration, resolutionLabel, installUrl, entryPath, creatorPath, humanDate } from '../catalog.js';
import { rootPath, DEEP_LINK, SOFTWARE } from '../config.js';
import { animationCard } from '../ui/card.js';

const FACT_LABELS = {
  sha256: 'SHA-256',
};

function factsTable(entry) {
  const dl = el('dl', { class: 'facts' });
  const rows = [
    ['作者', entry.author, entry.author ? rootPath(creatorPath(entry.author)) : null],
    ['分辨率', resolutionLabel(entry)],
    ['帧率', entry.fps ? `${entry.fps} fps` : ''],
    ['时长', entry.duration ? formatDuration(entry.duration) : ''],
    ['体积', entry.bytes ? formatBytes(entry.bytes) : ''],
    ['许可', entry.license],
    ['上架日期', humanDate(entry.submitted)],
    ['版本', entry.version],
  ].filter(([, v]) => v !== undefined && v !== null && v !== '' && v !== '—');

  for (const [k, v, href] of rows) {
    dl.append(el('dt', { text: k }));
    if (href) dl.append(el('dd', {}, [el('a', { class: 'link', href, text: String(v) })]));
    else dl.append(el('dd', { text: String(v) }));
  }
  return dl;
}

function sha256Block(entry) {
  if (!entry.sha256) return null;
  const box = el('div', { class: 'stack stack--tight' });
  const label = el('span', { class: 'muted small', text: `${FACT_LABELS.sha256}（客户端下载后用它校验，不符就拒绝安装）` });
  const row = el('div', { class: 'row' });
  const code = el('code', { text: entry.sha256, style: 'flex:1;word-break:break-all' });
  const btn = el('button', { class: 'btn btn--sm', type: 'button', text: '复制' });
  btn.addEventListener('click', async () => {
    toast((await copyText(entry.sha256)) ? '哈希已复制' : '复制失败，请手动选中', 'err');
  });
  row.append(code, btn);
  box.append(label, row);
  return box;
}

/** 深链唤起：点了之后检测"页面是否失去焦点"来判断客户端在不在。 */
function makeUseButton(entry, noteHost) {
  const btn = el('button', { class: 'btn btn--primary btn--lg', type: 'button' });
  const ic = icon('windows', 16, 'btn__icon');
  if (ic) btn.append(ic);
  btn.append(document.createTextNode('用开机动画打开'));

  btn.addEventListener('click', () => {
    let hidden = false;
    const onHide = () => { hidden = true; };
    document.addEventListener('visibilitychange', onHide, { once: true });
    window.addEventListener('blur', onHide, { once: true });

    try {
      location.href = installUrl(entry);
    } catch {
      /* 某些浏览器对未知协议直接抛，走下面的兜底 */
    }

    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      if (hidden) return; // 客户端接住了
      if (noteHost) {
        noteHost.hidden = false;
        noteHost.textContent = '没检测到客户端响应 —— 可能还没装「开机动画」，或者系统里没有注册 bootanim:// 协议。用下面的「下载并手动导入」一样能装上。';
      }
    }, DEEP_LINK.probeMs);
  });

  return btn;
}

export async function init({ repo }) {
  const main = $('#ba-main');
  const id = (document.body.dataset.animationId || new URLSearchParams(location.search).get('id') || '').trim();
  if (!main) return;
  if (!id) {
    main.replaceChildren(stateBlock({
      kind: 'error',
      title: '没有指定动画',
      text: '这个地址里缺少动画 id。回动画库挑一个吧。',
      action: el('a', { class: 'btn btn--primary', href: rootPath('animations/'), text: '去动画库' }),
    }));
    return;
  }

  let entries = [];
  try {
    entries = await repo.getAnimations();
  } catch (error) {
    // 静态 HTML 里已有内容：保留它，只在顶部提示数据可能不是最新
    const banner = stateBlock({
      kind: 'offline',
      title: '取不到最新目录',
      text: `下面显示的是页面自带的静态信息，可能不是最新。${error?.message || error}`,
    });
    banner.style.marginBottom = 'var(--s-5)';
    main.prepend(banner);
    return;
  }

  const entry = entries.find((e) => String(e.id) === id);
  if (!entry) {
    main.replaceChildren(stateBlock({
      kind: 'empty',
      title: '这个动画不在目录里了',
      text: `id「${id}」可能被作者撤下或被下架。目录里现在有 ${entries.length} 个动画。`,
      action: el('a', { class: 'btn btn--primary', href: rootPath('animations/'), text: '去动画库' }),
    }));
    return;
  }

  // NSFW 闸门：列表默认不显示，直接点进来也要先确认一次
  if (entry.nsfw && sessionStorage.getItem('ba:nsfw-ok:' + entry.id) !== '1') {
    const gate = stateBlock({
      kind: 'error',
      title: '这条被作者标记为不适宜内容',
      text: '目录默认隐藏这类内容。你确认要看就继续，之后这次会话不再追问。',
    });
    const ok = el('button', { class: 'btn btn--primary', type: 'button', text: '继续查看' });
    ok.addEventListener('click', () => {
      try { sessionStorage.setItem('ba:nsfw-ok:' + entry.id, '1'); } catch { /* 隐私模式 */ }
      location.reload();
    });
    gate.append(ok);
    main.replaceChildren(gate);
    return;
  }

  /* ── 播放器 ── */
  const playerHost = $('#ba-player');
  if (playerHost) {
    playerHost.replaceChildren(posterPlayer({
      src: entry.video,
      poster: entry.preview,
      title: entry.name,
    }));
  }

  /* ── 事实表 + 哈希 ── */
  const factsHost = $('#ba-facts');
  if (factsHost) factsHost.replaceChildren(factsTable(entry));
  const shaHost = $('#ba-sha');
  if (shaHost) {
    const block = sha256Block(entry);
    shaHost.replaceChildren(block || el('span', { class: 'muted small', text: '条目里没有哈希（异常，建议举报）' }));
  }

  /* ── 操作区 ── */
  const actions = $('#ba-actions');
  const note = $('#ba-deeplink-note');
  if (note) note.hidden = true;
  if (actions) {
    actions.replaceChildren();

    const dl = el('a', {
      class: 'btn btn--lg',
      href: entry.video,
      download: `${entry.id}.mp4`,
      rel: 'noopener',
    });
    const dic = icon('download', 16, 'btn__icon');
    if (dic) dl.append(dic);
    dl.append(document.createTextNode(`下载 mp4${entry.bytes ? ' · ' + formatBytes(entry.bytes) : ''}`));

    const use = makeUseButton(entry, note);

    const copyLink = el('button', { class: 'btn btn--ghost', type: 'button', text: '复制本条链接' });
    copyLink.addEventListener('click', async () => {
      const url = new URL(entryPath(entry.id), location.origin + rootPath('')).href;
      toast((await copyText(url)) ? '链接已复制' : '复制失败', 'err');
    });

    actions.append(use, dl, copyLink);
  }

  /* ── 手动导入说明（深链不成功时的正经退路） ── */
  const importHost = $('#ba-import');
  if (importHost) {
    importHost.replaceChildren(
      el('p', { class: 'muted small', text: '没装客户端也能用：下载 mp4 之后，在软件里用命令行播放任意文件：' }),
      el('pre', {}, [el('code', { text: `"%LOCALAPPDATA%\\Programs\\BootAnimation\\BootAnimation.exe" --file "下载的文件.mp4"` })]),
      el('p', { class: 'muted small', text: `或者装好软件再回来点「用开机动画打开」—— 它会下载、用 sha256 校验、然后放到 ${SOFTWARE.install.dataDir}community\\，和内置片头一起出现在选片窗口里。` }),
    );
  }

  /* ── 相关：同作者 / 同标签 ── */
  const relatedHost = $('#ba-related');
  if (relatedHost) {
    const sameAuthor = entries.filter((e) => e.id !== entry.id && e.author && e.author === entry.author);
    const sharedTag = entries.filter((e) => e.id !== entry.id && (e.tags || []).some((t) => (entry.tags || []).includes(t)));
    const picks = [...sameAuthor, ...sharedTag.filter((e) => !sameAuthor.includes(e))].slice(0, 3);
    if (picks.length) {
      const grid = el('div', { class: 'grid' });
      for (const e of picks) grid.append(animationCard(e));
      relatedHost.replaceChildren(grid);
    } else {
      relatedHost.replaceChildren(el('p', { class: 'muted small', text: `目录里目前只有 ${entries.length} 个动画，还没有相关的。` }));
    }
  }

  document.body.dataset.ready = 'true';
}
