/**
 * video.js — 视频只在**真的要播**时才加载。
 *
 * 这是性能要求的落点：
 *   - 卡片上不放 <video>，只放预览图（webp/jpg）。目录页因此永远只有图片请求。
 *   - 详情页先渲染 poster，用户点了才设 src。
 *   - 全站同一时刻**只允许一个视频在播**，进入视口不自动播（除了显式声明 autoplay 的场景）。
 *
 * 另外把「播放失败」做成可解释状态：解码不了 / 网络断了 / 404 都给出人话，
 * 而不是留一块黑屏（旧版客户端就吃过这个亏）。
 */
import { el, icon } from './dom.js';

/** 当前正在播的 <video>，用于互斥。 */
let current = null;

export function stopAll() {
  if (current && !current.paused) {
    try { current.pause(); } catch { /* 已卸载 */ }
  }
  current = null;
}

/**
 * 造一个「点了才播」的播放器。
 * @param {object} opts
 * @param {string} opts.src      视频直链
 * @param {string} [opts.poster] 预览图
 * @param {string} [opts.title]  aria-label
 * @returns {HTMLElement}
 */
export function posterPlayer(opts) {
  const wrap = el('div', { class: 'player' });
  const video = el('video', {
    controls: true,
    playsinline: true,
    preload: 'none',
    'aria-label': opts.title ? `${opts.title} 预览` : '动画预览',
  });
  video.hidden = true;

  const btn = el('button', { class: 'player__poster', type: 'button', 'aria-label': '播放预览' });
  if (opts.poster) {
    const img = el('img', { src: opts.poster, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.remove());
    btn.append(img);
  }
  const overlay = el('div', { class: 'player__play' }, [el('span', {}, [icon('play', 24)])]);
  const state = el('div', { class: 'player__state', text: '点一下播放预览 · 不会自动下载视频' });
  wrap.append(video, btn, overlay, state);

  let loaded = false;
  const fail = (message) => {
    video.hidden = true;
    btn.hidden = false;
    overlay.hidden = false;
    state.textContent = message;
  };

  btn.addEventListener('click', () => {
    if (!loaded) {
      loaded = true;
      video.src = opts.src;
      video.preload = 'auto';
    }
    btn.hidden = true;
    overlay.hidden = true;
    video.hidden = false;
    state.textContent = '';
    stopAll();
    current = video;
    const p = video.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => fail('浏览器拒绝了自动播放，点画面中间的播放键试试'));
    }
  });

  video.addEventListener('error', () => {
    const code = video.error && video.error.code;
    if (code === 4) fail('这个格式浏览器解不了（HEVC / ProRes 常见）—— 客户端能播，但网页预览不行');
    else if (code === 2) fail('视频读取中断，检查网络后重试');
    else fail('视频加载失败（可能是直链失效或作者撤下了文件）');
  });
  video.addEventListener('play', () => { if (current !== video) stopAll(); current = video; });

  return wrap;
}

/**
 * 卡片上的「悬停预览」：进视口不加载，悬停才加载，离开就暂停并停止加载。
 * 桌面端才启用；触屏与 reduced-motion 下永远不启用（省流量也省电量）。
 */
export function hoverPreview(container, opts) {
  if (opts.disabled) return null;
  let video = null;
  let timer = null;

  const start = () => {
    if (video) {
      video.play().catch(() => {});
      return;
    }
    video = el('video', {
      src: opts.src,
      muted: true,
      loop: true,
      playsinline: true,
      preload: 'none',
      'aria-hidden': 'true',
    });
    video.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .25s';
    container.append(video);
    video.addEventListener('canplay', () => { video.style.opacity = '1'; });
    video.addEventListener('error', () => { video.remove(); video = null; });
    video.play().catch(() => {});
  };

  const enter = () => {
    clearTimeout(timer);
    timer = setTimeout(start, 420); // 稍等再加载，快速划过不触发
  };
  const leave = () => {
    clearTimeout(timer);
    if (video) {
      try { video.pause(); } catch { /* noop */ }
      video.remove();
      video = null;
    }
  };

  container.addEventListener('pointerenter', enter);
  container.addEventListener('pointerleave', leave);
  container.addEventListener('focusin', enter);
  container.addEventListener('focusout', leave);
  return { destroy: leave };
}

/**
 * 视口内才加载的 <video>（用于首页 Hero 这类"确实要放视频"的位置）。
 * 用 IntersectionObserver，且只加载一次；同时受 prefers-reduced-motion 影响时不自动播。
 */
export function lazyVideo(opts) {
  const video = el('video', {
    poster: opts.poster || undefined,
    muted: opts.muted !== false,
    loop: opts.loop !== false,
    playsinline: true,
    preload: 'none',
    autoplay: false,
    'aria-hidden': 'true',
    class: opts.class || '',
  });
  video.style.cssText = 'width:100%;height:100%;object-fit:cover';

  if (typeof IntersectionObserver !== 'function') {
    video.src = opts.src; // 老浏览器：退化成普通加载
    return video;
  }

  const io = new IntersectionObserver((records) => {
    for (const rec of records) {
      if (!rec.isIntersecting) {
        if (!video.paused) video.pause();
        continue;
      }
      if (!video.src) video.src = opts.src;
      if (opts.autoplay !== false) video.play().catch(() => {});
    }
  }, { rootMargin: '200px 0px', threshold: 0.25 });

  io.observe(video);
  return video;
}
