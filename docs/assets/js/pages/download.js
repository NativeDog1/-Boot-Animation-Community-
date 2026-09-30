/**
 * download.js — 软件下载页。
 *
 * **不硬编码任何版本号**：版本与直链来自 `data/software.json`（维护者改一个文件）
 * 或 GitHub Releases 的 latest 入口。仓库里还没有发布时，如实说「尚未发布」并给出
 * 从源码构建的路径 —— 而不是编一个版本号、或者给一个点了 404 的链接。
 */
import { $, el, icon, clear, toast, copyText, stateBlock } from '../ui/dom.js';
import { formatBytes } from '../catalog.js';
import { SOFTWARE } from '../config.js';

function factRow(dl, k, v) {
  if (v === undefined || v === null || v === '') return;
  dl.append(el('dt', { text: k }));
  dl.append(el('dd', { text: String(v) }));
}

export async function init({ repo }) {
  const main = $('#ba-main');
  const versionHost = $('#ba-dl-version');
  const actionsHost = $('#ba-dl-actions');
  const factsHost = $('#ba-dl-facts');
  const notesHost = $('#ba-dl-notes');
  if (!main) return;

  let manifest = null;
  try {
    manifest = await repo.getSoftware();
  } catch {
    manifest = null;
  }

  const version = manifest && manifest.version ? String(manifest.version) : '';
  const downloadUrl = (manifest && (manifest.downloadUrl || manifest.url)) || SOFTWARE.releasesUrl;
  const releaseDate = manifest && manifest.releaseDate ? String(manifest.releaseDate) : '';
  const sizeBytes = manifest && manifest.size ? Number(manifest.size) : 0;
  const changelogUrl = (manifest && manifest.changelogUrl) || `${SOFTWARE.allReleasesUrl}`;

  /* ── 版本状态 ── */
  if (versionHost) {
    clear(versionHost);
    if (version) {
      versionHost.append(
        el('div', { class: 'row' }, [
          el('span', { class: 'badge badge--ok', text: '已发布' }),
          el('b', { text: `最新版本 ${version}` }),
          releaseDate ? el('span', { class: 'muted small', text: releaseDate }) : null,
          sizeBytes ? el('span', { class: 'muted small', text: formatBytes(sizeBytes) }) : null,
        ]),
      );
    } else {
      versionHost.append(
        el('div', { class: 'callout callout--warn' }, [
          el('div', {}, [
            el('b', { text: '还没有发布安装包。' }),
            el('span', {
              text: ' 网站不会给一个点了 404 的下载按钮。当前源码已经能构建出可用的单文件 exe，按下面的步骤自己产出一个即可；等发布到 GitHub Releases 之后，这里的按钮会自动变成可下载状态（版本号与直链由仓库里的 data/software.json 提供，不需要改前端代码）。',
            }),
          ]),
        ]),
      );
    }
  }

  /* ── 主按钮 ── */
  if (actionsHost) {
    clear(actionsHost);
    const primary = el('a', {
      class: 'btn btn--primary btn--lg',
      href: version ? downloadUrl : SOFTWARE.releasesUrl,
      rel: 'noopener',
      target: version ? undefined : '_blank',
    });
    const wi = icon('windows', 18, 'btn__icon');
    if (wi) primary.append(wi);
    primary.append(document.createTextNode(version ? '下载 Windows 版' : '查看 Releases 页面'));

    const gh = el('a', { class: 'btn btn--lg', href: SOFTWARE.allReleasesUrl, target: '_blank', rel: 'noopener' });
    const gi = icon('github', 16, 'btn__icon');
    if (gi) gh.append(gi);
    gh.append(document.createTextNode('全部版本'));

    const log = el('a', { class: 'btn btn--ghost btn--lg', href: changelogUrl, target: '_blank', rel: 'noopener', text: '更新日志' });

    actionsHost.append(primary, gh, log);
  }

  /* ── 版本事实 ── */
  if (factsHost) {
    clear(factsHost);
    const dl = el('dl', { class: 'facts' });
    factRow(dl, '适用系统', SOFTWARE.requirements.os);
    factRow(dl, '运行时', SOFTWARE.requirements.runtime);
    factRow(dl, '磁盘占用', SOFTWARE.requirements.disk);
    factRow(dl, '管理员权限', SOFTWARE.requirements.admin);
    factRow(dl, '安装位置', SOFTWARE.install.dir);
    factRow(dl, '开机自启', SOFTWARE.install.runKey);
    factRow(dl, '数据目录（卸载保留）', SOFTWARE.install.dataDir);
    if (version) factRow(dl, '发布版本', version);
    if (manifest && manifest.sha256) factRow(dl, 'SHA-256', manifest.sha256);
    if (manifest && manifest.signed === false) factRow(dl, '代码签名', '暂无（首次运行会有 SmartScreen 提示）');
    factsHost.append(dl);
  }

  /* ── 未发布时给出真实可行的构建路径 ── */
  if (notesHost) {
    clear(notesHost);
    if (!version) {
      notesHost.append(
        el('div', { class: 'callout callout--info' }, [
          el('div', {}, [
            el('b', { text: '自己构建（需要 Windows + PowerShell，无需装任何 SDK）：' }),
            el('p', { class: 'small muted', text: '源码用 Windows 自带的 csc 编译器构建，产出播放器与安装包两个单文件 exe。' }),
          ]),
        ]),
        el('pre', {}, [el('code', { text: 'git clone https://github.com/' + SOFTWARE.repo + '.git\ncd ' + SOFTWARE.repo.split('/').pop() + '\n.\\build.ps1        # 产出 BootAnimation.exe 与 BootAnimation-Setup.exe' })]),
        (() => {
          const row = el('div', { class: 'btn-row' });
          const copy = el('button', { class: 'btn', type: 'button', text: '复制构建命令' });
          copy.addEventListener('click', async () => {
            toast((await copyText('git clone https://github.com/' + SOFTWARE.repo + '.git && cd ' + SOFTWARE.repo.split('/').pop() + ' && .\\build.ps1')) ? '命令已复制' : '复制失败', 'err');
          });
          row.append(copy);
          row.append(el('a', { class: 'btn btn--ghost', href: `https://github.com/${SOFTWARE.repo}`, target: '_blank', rel: 'noopener', text: '源码仓库' }));
          return row;
        })(),
      );
    } else {
      notesHost.append(el('p', { class: 'muted small', text: '安装包由作者签名前会触发 SmartScreen 提示 —— 这是微软的信任机制，不是错误。安装步骤见文档。' }));
    }
  }

  document.body.dataset.ready = 'true';
}
