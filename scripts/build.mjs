import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { path, readJson, writeJson, sha256, stableVersion, repository } from './lib.mjs';

export async function build({ repo, output = path('dist') } = {}) {
  const pkg = await readJson(path('package.json'));
  const vendor = await readJson(path('vendor/eruda.json'));
  const source = await readFile(path('vendor/eruda.js'));
  const license = await readFile(path('vendor/LICENSE.eruda'));
  if (sha256(source) !== vendor.sha256 || sha256(license) !== vendor.licenseSha256) {
    throw new Error('vendor 校验失败，拒绝打包。请恢复文件或重新更新 Eruda。');
  }
  const version = `${stableVersion(pkg.version)}.${stableVersion(vendor.version)}`;
  const resolvedRepo = repository(repo);
  const homepage = resolvedRepo ? `https://github.com/${resolvedRepo}` : null;
  const downloadBase = homepage ? `${homepage}/releases/latest/download` : null;
  const metadata = [
    '// ==UserScript==',
    '// @name         Eruda 离线调试助手',
    '// @namespace    eruda-offline-userscript',
    `// @version      ${version}`,
    `// @description  手机页面离线调试，内置 Eruda ${vendor.version}，支持油猴菜单和隐藏悬浮球`,
    '// @author       Double-Cloth',
    '// @license      MIT',
    '// @match        http://*/*',
    '// @match        https://*/*',
    '// @match        file:///*',
    '// @run-at       document-start',
    '// @noframes',
    '// @sandbox      raw',
    '// @inject-into  page',
    ...['unsafeWindow', 'GM_getValue', 'GM_setValue', 'GM_registerMenuCommand', 'GM_addElement',
      'GM.getValue', 'GM.setValue', 'GM.registerMenuCommand', 'GM.addElement'].map((grant) => `// @grant        ${grant}`),
    ...(homepage ? [`// @homepageURL  ${homepage}`, `// @supportURL   ${homepage}/issues`,
      `// @updateURL    ${downloadBase}/eruda-offline.meta.js`,
      `// @downloadURL  ${downloadBase}/eruda-offline.user.js`] : []),
    '// ==/UserScript==', '',
  ].join('\n');
  let page = await readFile(path('src/page.js'), 'utf8');
  const editor = await readFile(path('src/elements-editor.js'), 'utf8');
  page = page.replace('/* ELEMENTS_EDITOR */', () => editor);
  const embedded = source.toString().replace(/^\/\/[#@] sourceMappingURL=.*$/gm, '');
  page = page.replace('/* ERUDA_VENDOR */', () => embedded);
  const controller = (await readFile(path('src/userscript.js'), 'utf8'))
    .replace('__SCRIPT_VERSION__', version)
    .replace('__ERUDA_VERSION__', vendor.version)
    .replace('/* PAGE_MAIN */', () => page);
  const result = `${metadata}\n/*\n内置 Eruda ${vendor.version}，上游许可证：\n${license.toString().trim()}\n*/\n\n${controller}`;
  new Script(result, { filename: 'eruda-offline.user.js' });
  if (/^\/\/\s*@(require|resource)\s/m.test(result)) throw new Error('产物不得依赖外部资源。');
  await mkdir(output, { recursive: true });
  const artifacts = { 'eruda-offline.user.js': result, 'eruda-offline.meta.js': metadata,
    'LICENSE.eruda.txt': license };
  for (const [name, content] of Object.entries(artifacts)) await writeFile(path(output, name), content);
  const manifest = { version, erudaVersion: vendor.version, repository: resolvedRepo,
    files: Object.fromEntries(Object.entries(artifacts).map(([name, content]) => [name, sha256(content)])) };
  await writeJson(path(output, 'build-info.json'), manifest);
  await writeFile(path(output, 'SHA256SUMS.txt'), `${Object.entries(manifest.files).map(([name, hash]) => `${hash}  ${name}`).join('\n')}\n`);
  return manifest;
}

if (process.argv[1] && path('scripts/build.mjs') === path(process.argv[1])) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--repository')) {
    console.error('用法：npm run build -- [--repository owner/repo]');
    process.exitCode = 1;
  } else {
    build({ repo: args[1] }).then((info) => {
      console.log(`已离线构建 ${info.version} → dist/eruda-offline.user.js`);
      if (!info.repository) console.log('尚未绑定 GitHub 仓库：当前产物不含远程更新地址。');
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
  }
}
