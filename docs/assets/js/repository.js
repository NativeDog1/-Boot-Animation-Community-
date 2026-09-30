/**
 * repository.js — 取数的**唯一入口**。
 *
 * 为什么要有这一层（而不是让页面各自 fetch）：今天的目录是 GitHub 上的静态 JSON，
 * 明天可能是 Cloudflare Workers / Supabase / 自建 API。UI 只认下面这个接口，
 * 换数据源 = 换一个实现类，页面一行都不用改。
 *
 * @typedef {Object} AnimationRepository
 * @property {string} source            当前实现的标识（显示在页脚，便于排错）
 * @property {'ok'|'stale'|'error'} status
 * @property {string} lastError
 * @property {() => Promise<object[]>} getAnimations
 * @property {(id: string) => Promise<object|null>} getAnimation
 * @property {() => Promise<object[]>} getCreators
 * @property {(id: string) => Promise<object|null>} getCreator
 * @property {() => Promise<{tags: object[], resolutions: object[]}>} getCategories
 * @property {(q: string, opts?: object) => Promise<object[]>} searchAnimations
 * @property {() => Promise<object|null>} getSoftware
 */
import { CATALOG_TTL_MS, SOFTWARE, REPO, BRANCH, REPO_ROOT } from './config.js';
import {
  loadCatalog, creatorsOf, collectTags, filterEntries, resolutionBucket, RESOLUTION_LABELS,
} from './catalog.js';

const CACHE_KEY = 'ba:catalog:v1';

/** sessionStorage 可能被隐私模式禁用 —— 拿不到就当没有缓存，绝不抛。 */
function safeStorage() {
  try {
    const s = globalThis.sessionStorage;
    s.setItem('ba:probe', '1');
    s.removeItem('ba:probe');
    return s;
  } catch {
    return null;
  }
}

export class GitHubStaticRepository {
  /**
   * @param {{fetchImpl?: typeof fetch, ttl?: number, storage?: Storage|null}} [opts]
   */
  constructor(opts = {}) {
    this.fetchImpl = opts.fetchImpl || globalThis.fetch.bind(globalThis);
    this.ttl = opts.ttl ?? CATALOG_TTL_MS;
    this.storage = opts.storage === undefined ? safeStorage() : opts.storage;
    this.status = 'ok';
    this.lastError = '';
    this.sourceLabel = '';
    this._entries = null;
  }

  get source() {
    return 'GitHubStaticRepository' + (this.sourceLabel ? ` (${this.sourceLabel})` : '');
  }

  _readCache() {
    if (!this.storage) return null;
    try {
      const raw = this.storage.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.entries)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  _writeCache(entries, url) {
    if (!this.storage) return;
    try {
      this.storage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), entries, url }));
    } catch { /* 配额满 / 隐私模式：缓存失败不影响功能 */ }
  }

  /**
   * 目录。顺序：新鲜缓存 → 远端 → 过期缓存（离线降级）。
   * 远端失败但缓存还在时 **status = 'stale'**，页面据此显示「离线，显示的是上次的目录」，
   * 而不是白屏或假装一切正常。
   */
  async getAnimations({ force = false } = {}) {
    if (this._entries && !force) return this._entries;

    const cached = this._readCache();
    const fresh = cached && Date.now() - cached.at < this.ttl;
    if (fresh && !force) {
      this._entries = cached.entries;
      this.sourceLabel = cached.url || '缓存';
      this.status = 'ok';
      return this._entries;
    }

    try {
      const { entries, url } = await loadCatalog(this.fetchImpl);
      this._entries = entries;
      this.sourceLabel = url;
      this.status = 'ok';
      this.lastError = '';
      this._writeCache(entries, url);
      return entries;
    } catch (error) {
      this.lastError = error && error.message ? error.message : String(error);
      if (cached) {
        this._entries = cached.entries;
        this.sourceLabel = cached.url || '缓存';
        this.status = 'stale';
        return cached.entries;
      }
      this.status = 'error';
      throw error;
    }
  }

  async getAnimation(id) {
    const list = await this.getAnimations();
    const key = String(id || '');
    return list.find((e) => String(e.id) === key) || null;
  }

  async getCreators() {
    return creatorsOf(await this.getAnimations());
  }

  async getCreator(id) {
    const key = String(id || '');
    return (await this.getCreators()).find((c) => String(c.id) === key || String(c.name) === key) || null;
  }

  /** 「分类」= 数据里真实存在的标签与分辨率归档，绝不编造分类树。 */
  async getCategories() {
    const list = await this.getAnimations();
    const resolutions = new Map();
    for (const e of list) {
      const b = resolutionBucket(e);
      resolutions.set(b, (resolutions.get(b) || 0) + 1);
    }
    return {
      tags: collectTags(list),
      resolutions: [...resolutions.entries()].map(([id, count]) => ({
        id, count, label: RESOLUTION_LABELS[id] || id,
      })),
    };
  }

  async searchAnimations(query, opts = {}) {
    return filterEntries(await this.getAnimations(), { ...opts, query });
  }

  /**
   * 软件版本清单。仓库里放 `data/software.json` 就显示版本号与直链；
   * 不存在就返回 null —— 页面如实说「尚未发布」，而不是编一个版本号。
   *
   * 取数顺序与目录一致（raw → jsDelivr → 本地）：本地那条让 `npm run serve`
   * 开发时看到的就是仓库里的真实状态，不必先推上去。
   */
  async getSoftware() {
    const urls = [
      `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${SOFTWARE.manifest}`,
      `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/${SOFTWARE.manifest}`,
      new URL(SOFTWARE.manifest, REPO_ROOT).href,
    ];
    for (const url of urls) {
      try {
        const r = await this.fetchImpl(url, { cache: 'no-cache' });
        if (!r.ok) continue;
        const d = await r.json();
        if (d && typeof d === 'object') return d;
      } catch {
        /* 试下一个源 */
      }
    }
    return null;
  }
}

/** 测试与离线演示用：把数据直接塞进去，不碰网络。 */
export class MemoryRepository {
  constructor(entries = [], extra = {}) {
    this.entries = entries;
    this.extra = extra;
    this.status = 'ok';
    this.lastError = '';
  }

  get source() { return 'MemoryRepository'; }
  async getAnimations() { return this.entries; }
  async getAnimation(id) { return this.entries.find((e) => String(e.id) === String(id)) || null; }
  async getCreators() { return creatorsOf(this.entries); }
  async getCreator(id) {
    const key = String(id);
    return (await this.getCreators()).find((c) => String(c.id) === key || String(c.name) === key) || null;
  }
  async getCategories() {
    const resolutions = new Map();
    for (const e of this.entries) {
      const b = resolutionBucket(e);
      resolutions.set(b, (resolutions.get(b) || 0) + 1);
    }
    return {
      tags: collectTags(this.entries),
      resolutions: [...resolutions.entries()].map(([id, count]) => ({ id, count, label: RESOLUTION_LABELS[id] || id })),
    };
  }
  async searchAnimations(query, opts = {}) { return filterEntries(this.entries, { ...opts, query }); }
  async getSoftware() { return this.extra.software ?? null; }
}

let _instance = null;

/**
 * 全站共用同一个仓储实例 —— 这样页面之间共享缓存与 status。
 * 想换实现（将来接 Serverless）：改这一处即可。
 */
export function getRepository() {
  if (!_instance) _instance = new GitHubStaticRepository();
  return _instance;
}

/** 单测/故事书用：注入别的实现。 */
export function setRepository(impl) {
  _instance = impl;
  return _instance;
}
