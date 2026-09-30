/**
 * app.js（兼容垫片）
 *
 * 旧版的单页应用（目录浏览 + 投稿向导）已经拆成模块：
 *   - 纯逻辑与目录函数 → assets/js/catalog.js
 *   - 投稿向导          → assets/js/ui/submit-wizard.js
 *   - 页面              → assets/js/pages/*.js
 *
 * 这个文件保留原来的导入路径，让任何已经 `import ... from './app.js'`
 * 的脚本（比如你自己写的 Node 单测）继续能用。**新代码请直接 import 新模块。**
 */
export {
  REPO,
  BRANCH,
  catalogSources,
  loadCatalog,
  formatBytes,
  formatDuration,
  resolutionLabel,
  resolutionBucket,
  durationBucket,
  collectTags,
  creatorsOf,
  filterEntries,
  sortEntries,
  matchesQuery,
  installUrl,
  submitIssueUrl,
  suggestSlug,
  validateLocalFile,
  sha256OfFile,
  readVideoMeta,
  entryPath,
  creatorPath,
  humanDate,
  isNew,
  buildSearchIndex,
  searchIndex,
} from './assets/js/catalog.js';

export { openWizard } from './assets/js/ui/submit-wizard.js';
