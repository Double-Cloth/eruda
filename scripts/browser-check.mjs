import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { path } from './lib.mjs';
import { checkElements } from './browser-elements-check.mjs';

// 使用 Node 内置 WebSocket 和 Chrome DevTools Protocol，不增加 npm 依赖。
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      for (const app of ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe']) {
        if (existsSync(join(base, app))) return join(base, app);
      }
    }
  } else if (process.platform === 'darwin') {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (existsSync(chrome)) return chrome;
  } else {
    for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
      try { return execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
      catch { /* 尝试下一个浏览器。 */ }
    }
  }
  throw new Error('未找到 Chrome/Edge。请设置 CHROME_PATH 指向浏览器可执行文件。');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = await mkdtemp(join(tmpdir(), 'eruda-browser-'));
const executable = findChrome();
const launchStarted = Date.now();
console.log(`启动浏览器：${executable}（${process.platform}）`);
const browser = spawn(executable, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-extensions', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
let launchError;
let browserClosed = false;
let browserStderr = '';
browser.on('error', (error) => { launchError = error; });
browser.stderr.setEncoding('utf8');
browser.stderr.on('data', (data) => { browserStderr = (browserStderr + data).slice(-16_384); });
browser.on('close', () => { browserClosed = true; });
function startupFailure(reason) {
  return new Error(`${reason}\n浏览器：${executable}\n退出码：${browser.exitCode}，信号：${browser.signalCode}\n${browserStderr.trim() || '浏览器没有输出错误日志。'}`);
}
let socket;
let server;

try {
  let portInfo;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (launchError) throw startupFailure(`浏览器启动失败：${launchError.message}`);
    if (browserClosed) throw startupFailure('浏览器在开放调试端口前提前退出。');
    try {
      const candidate = await readFile(join(profile, 'DevToolsActivePort'), 'utf8');
      // 文件可能仍在写入，等到端口和 WebSocket 路径完整后再连接。
      if (/^\d+\r?\n\/devtools\/browser\/[^\s]+\s*$/.test(candidate)) { portInfo = candidate; break; }
    } catch (error) {
      if (error.code !== 'ENOENT') throw startupFailure(`无法读取调试端口：${error.message}`);
    }
    await sleep(100);
  }
  if (!portInfo) throw startupFailure('浏览器启动超时（30 秒）。');
  const [port, endpoint] = portInfo.trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  console.log(`浏览器调试连接已就绪（${Date.now() - launchStarted} ms）`);
  let id = 0;
  const pending = new Map();
  const requests = [];
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const task = pending.get(message.id);
      if (task) {
        clearTimeout(task.timer);
        pending.delete(message.id);
        message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
      }
    } else if (message.method === 'Network.requestWillBeSent') {
      requests.push(message.params.request.url);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    }
  });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP 超时：${method}`)); }, 15_000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  const source = await readFile(path('dist/eruda-offline.user.js'), 'utf8');
  const fixture = await readFile(path('tests/fixtures/gm.js'), 'utf8');
  const html = await readFile(path('tests/fixtures/page.html'));
  // 用响应头确保策略在用户脚本启动前生效，比 GitHub 的字体白名单更严格。
  server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "font-src 'none'" });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const cspUrl = `http://127.0.0.1:${server.address().port}/`;
  for (const mode of ['csp', 'desktop', 'legacy', 'modern', 'injected', 'no-menu']) {
    const url = mode === 'csp' ? cspUrl : pathToFileURL(path('tests/fixtures/page.html')).href;
    const { browserContextId } = await send('Target.createBrowserContext');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const cdp = (method, params) => send(method, params, sessionId);
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Network.enable');
    await cdp('DOM.enable');
    await cdp('CSS.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: mode === 'desktop' ? 1280 : 390, height: 844, deviceScaleFactor: 1, mobile: mode !== 'desktop' });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: mode !== 'desktop' });
    let adapter = '';
    if (mode === 'modern') adapter = `
      window.GM = Object.fromEntries(['getValue', 'setValue', 'registerMenuCommand', 'unregisterMenuCommand'].map(name => {
        const fn = window['GM_' + name]; delete window['GM_' + name];
        return [name, async (...args) => fn(...args)];
      }));`;
    if (mode === 'injected') adapter = `
      window.unsafeWindow = {};
      window.GM_addElement = (name, attrs) => {
        const element = document.createElement(name); Object.assign(element, attrs);
        document.head.appendChild(element); return element;
      };`;
    if (mode === 'no-menu') adapter = 'delete window.GM_registerMenuCommand;';
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `${fixture}\n${adapter}\nwindow.fixtureOriginalConsole = console.log; window.fixtureOriginalFetch = window.fetch; window.eruda = { sentinel: true };\n${source}` });
    const evaluate = async (expression) => {
      const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 10_000 });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async (expression) => {
      for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(50); }
      throw new Error(`${mode} 验证超时：${expression}`);
    };
    const menu = (contains) => evaluate(`window.fixtureMenus.get([...window.fixtureMenus.keys()].find(label => label.includes(${JSON.stringify(contains)})))()`);
    const startupStart = requests.length;
    await cdp('Page.navigate', { url });
    await waitFor(`document.readyState === 'complete' && !!document.querySelector('#eruda-offline-panel')?.shadowRoot`);
    assert.deepEqual(requests.slice(startupStart).filter((request) => request !== url && !request.endsWith('/favicon.ico') && !/^(data|blob):/.test(request)), [], '启动仅加载测试页面和内嵌资源');
    const root = `document.querySelector('#eruda-offline-panel').shadowRoot`;
    const checkConsoleLevels = async () => {
      const control = `${root}.querySelector('.eruda-console .eruda-control')`;
      const logs = `${root}.querySelector('.eruda-console .eruda-logs-container')`;
      const levels = ['info', 'warning', 'error', 'all'];
      await evaluate(`${control}.querySelector('.eruda-clear-console').click();
        console.log('LEVEL_LOG'); console.info('LEVEL_INFO');
        console.warn('LEVEL_WARNING'); console.error('LEVEL_ERROR');`);
      await waitFor(`${logs}.textContent.includes('LEVEL_ERROR')`);
      for (const level of [...levels, ...levels]) {
        const button = `${control}.querySelector('[data-level="${level}"]')`;
        const point = await evaluate(`(() => {
          const rect = ${button}.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        })()`);
        if (mode === 'desktop') {
          await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
          await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
        } else {
          await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
          await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
        const expected = level === 'all' ? ['LEVEL_ERROR', 'LEVEL_INFO', 'LEVEL_LOG', 'LEVEL_WARNING']
          : level === 'info' ? ['LEVEL_INFO', 'LEVEL_LOG'] : [`LEVEL_${level.toUpperCase()}`];
        await waitFor(`JSON.stringify((${logs}.textContent.match(/LEVEL_[A-Z]+/g) || []).sort()) === ${JSON.stringify(JSON.stringify(expected))}`);
        assert.deepEqual(await evaluate(`Array.from(${control}.querySelectorAll('.eruda-level.eruda-active'), el => el.dataset.level)`),
          [level], `${mode}：筛选 ${level} 后只能高亮对应按钮`);
        await evaluate(`Promise.all(${control}.getAnimations({ subtree: true }).map(animation => animation.finished))`);
        assert.notEqual(await evaluate(`getComputedStyle(${button}).backgroundColor`),
          await evaluate(`getComputedStyle(${control}.querySelector('.eruda-level:not(.eruda-active)')).backgroundColor`),
          '选中按钮应实际显示不同的高亮背景');
        if (level === 'info' && ['desktop', 'legacy'].includes(mode)) {
          await mkdir(path('output/playwright'), { recursive: true });
          const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
          await writeFile(path(`output/playwright/console-filter-${mode}.png`), Buffer.from(screenshot.data, 'base64'));
        }
      }
      await evaluate(`${control}.querySelector('.eruda-clear-console').click()`);
    };
    assert.equal(await evaluate('window.eruda.sentinel'), true, '保留页面已有 Eruda');
    const entryDisplay = `getComputedStyle(${root}.querySelector('.eruda-entry-btn')).display`;
    const assertIconFont = async (selector) => {
      assert.equal(await evaluate(`(() => {
        const el = ${root}.querySelector(${JSON.stringify(selector)});
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && parseFloat(getComputedStyle(el, '::before').fontSize) > 0;
      })()`), true, `${selector} 应有可见尺寸，不能因工具栏样式失效变成零字号`);
      await cdp('DOM.getDocument', { depth: -1, pierce: true });
      const { result } = await cdp('Runtime.evaluate', { expression: `${root}.querySelector(${JSON.stringify(selector)})` });
      const { nodeId } = await cdp('DOM.requestNode', { objectId: result.objectId });
      const { node } = await cdp('DOM.describeNode', { nodeId, depth: 1 });
      const before = node.pseudoElements?.find((item) => item.pseudoType === 'before');
      assert.ok(before, `${selector} 应生成图标伪元素`);
      const { fonts } = await cdp('CSS.getPlatformFontsForNode', { nodeId: before.nodeId });
      assert.ok(fonts.some((font) => font.isCustomFont && font.glyphCount > 0),
        `${mode}：${selector} 应实际使用内嵌字体绘制，实际 ${JSON.stringify(fonts)}`);
      await cdp('Runtime.releaseObject', { objectId: result.objectId });
    };
    const assertEntryCentered = async () => {
      const offset = await evaluate(`(() => {
        const entry = ${root}.querySelector('.eruda-entry-btn');
        const box = entry.getBoundingClientRect();
        const icon = entry.querySelector('.eruda-icon-tool').getBoundingClientRect();
        return { width: icon.width, height: icon.height,
          x: Math.abs(icon.x + icon.width / 2 - box.x - box.width / 2),
          y: Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2) };
      })()`);
      assert.ok(offset.width > 0 && offset.height > 0 && offset.x < 1 && offset.y < 1,
        `${mode}：悬浮球显示后图标应居中，实际偏差 ${JSON.stringify(offset)}`);
      await assertIconFont('.eruda-icon-tool');
    };
    if (mode === 'no-menu') {
      assert.notEqual(await evaluate(entryDisplay), 'none');
      await assertEntryCentered();
      await send('Target.disposeBrowserContext', { browserContextId });
      console.log(`✓ ${mode}：缺少菜单时浮球仍可触达`);
      continue;
    }
    assert.equal(await evaluate('window.fixtureMenus.size'), 5);
    await evaluate('window.fixtureCapturedConsole = console.log');
    assert.equal(await evaluate(entryDisplay), 'none');
    await menu('打开调试面板');
    assert.equal(await evaluate(`window.fixtureMenus.has('Eruda：关闭调试面板')`), true);
    await waitFor(`${root}.textContent.includes('body 阶段执行')`);
    await evaluate('document.fonts.ready');
    await assertIconFont('.eruda-clear-console');
    await evaluate(`console.log('ICON_CLEAR_PROBE')`);
    await waitFor(`${root}.textContent.includes('ICON_CLEAR_PROBE')`);
    await evaluate(`${root}.querySelector('.eruda-clear-console').click()`);
    await waitFor(`!${root}.textContent.includes('ICON_CLEAR_PROBE')`);
    await checkConsoleLevels();
    if (mode === 'csp') {
      await menu('显示悬浮球');
      await assertEntryCentered();
      await mkdir(path('output/playwright'), { recursive: true });
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
      await writeFile(path('output/playwright/csp-icons.png'), Buffer.from(screenshot.data, 'base64'));
      await menu('隐藏悬浮球');
    }
    await evaluate(`console.log('OFFLINE_PAGE_LOG', { answer: 42 }); fetch('data:application/json,%7B%22ok%22%3Atrue%7D').then(r => r.json())`);
    await waitFor(`${root}.textContent.includes('OFFLINE_PAGE_LOG')`);
    const probeStart = requests.length;
    await evaluate(`console.log('%cOFFLINE_CSS_PROBE', 'background-image:url(./eruda-unwanted-probe.png);padding:8px;color:green;')`);
    await waitFor(`${root}.textContent.includes('OFFLINE_CSS_PROBE')`);
    await evaluate(`
      console.log('%%cOFFLINE_PERCENT_PROBE', 'background-image:url(./eruda-percent-probe.png)');
      console.log('%s %cOFFLINE_MIXED_PROBE', '<img src="https://offline-probe.invalid/format.png">', 'background-image:url(./eruda-mixed-probe.png);color:red');
      console.log('%o %O', '<iframe src="https://offline-probe.invalid/frame"></iframe>', '<link rel="stylesheet" href="https://offline-probe.invalid/style.css">');
      console.assert(false, '%cOFFLINE_ASSERT_PROBE', 'background-image:url(./eruda-assert-probe.png)');
      console.group('%cOFFLINE_GROUP_PROBE', 'background-image:image-set("./eruda-group-probe.png" 1x)'); console.groupEnd();
    `);
    await waitFor(`${root}.textContent.includes('OFFLINE_GROUP_PROBE')`);
    await sleep(250);
    assert.deepEqual(requests.slice(probeStart).filter((url) => !/^(data|blob):/.test(url)), [], '日志样式不得加载外部资源');
    assert.notEqual(await evaluate('window.fetch === window.fixtureOriginalFetch'), true, '捕获页面 fetch');
    // 从此刻起浏览器断网；切换各面板不得触发 HTTP(S) 请求。
    await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    const requestStart = requests.length;
    const clickTab = async (name) => {
      await evaluate(`Array.from(${root}.querySelectorAll('.eruda-tab .luna-tab-item')).find(el => el.getAttribute('data-id') === ${JSON.stringify(name)}).click()`);
    };
    await clickTab('elements');
    const editor = `${root}.querySelector('.eruda-dom-editor')`;
    const row = `${root}.querySelector('.eruda-dom-viewer').querySelectorAll('.luna-dom-viewer-tree-item')`;
    const targetRow = `Array.from(${row}).find(el => Array.from(el.querySelectorAll('.luna-dom-viewer-attribute-value')).some(attr => attr.textContent === 'dom-edit-target'))`;
    const ensureFixtureVisible = async () => {
      await evaluate(`(() => {
        const body = Array.from(${row}).find(el => el.querySelector('.luna-dom-viewer-tag-name')?.textContent === 'body');
        if (!body.classList.contains('luna-dom-viewer-expanded')) body.querySelector('.luna-dom-viewer-toggle').click();
      })()`);
      await waitFor(`!!(${targetRow})`);
    };
    const editValue = async (text) => {
      await evaluate(`(() => {
        const input = ${editor}.querySelector('textarea'); input.value = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await waitFor(`${editor}.querySelector('code').textContent === ${editor}.querySelector('textarea').value`);
    };
    const applyEdit = async () => evaluate(`${editor}.querySelector('button[type="submit"]').click()`);
    const cancelEdit = async () => evaluate(`${editor}.querySelector('[data-action="cancel"]').click()`);
    const realClick = async (expression) => {
      const point = await evaluate(`(() => {
        const element = (${expression});
        element.scrollIntoView({ block: 'center' });
        const rect = element.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`);
      if (mode === 'desktop') {
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      } else {
        await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
    };
    const openEditor = async (expression) => {
      await evaluate(`(${expression}).click()`);
      assert.equal(await evaluate(`${editor}.hidden`), true, `${mode}：点击 DOM 树只选中，不打开编辑器`);
      await evaluate(`${root}.querySelector('.eruda-dom-edit-trigger').click()`);
      assert.equal(await evaluate(`${editor}.hidden`), false, `${mode}：点击工具栏编辑按钮打开编辑器`);
    };
    const clickAttribute = async (name) => openEditor(`Array.from((${targetRow}).querySelectorAll('.luna-dom-viewer-attribute-name')).find(el => el.textContent === ${JSON.stringify(name)})`);
    await ensureFixtureVisible();
    const rowById = (id) => `Array.from(${row}).find(el => Array.from(el.querySelectorAll('.luna-dom-viewer-attribute-value')).some(attr => attr.textContent === ${JSON.stringify(id)}))`;
    const expandRow = async (expression) => {
      await evaluate(`(() => { const el = (${expression}); if (!el.classList.contains('luna-dom-viewer-expanded')) el.querySelector('.luna-dom-viewer-toggle').click(); })()`);
      assert.equal(await evaluate(`${editor}.hidden`), true, '展开箭头不打开编辑器');
    };
    const openRow = async (expression, expectedId) => {
      await openEditor(expression);
      assert.equal(await evaluate(`${editor}.querySelector('.eruda-dom-edit-node').textContent`), `<div${expectedId ? '#' + expectedId : ''}>`, '编辑点击的 div，不沿用旧选择');
    };
    await expandRow(rowById('div-parent'));
    await openRow(rowById('div-empty'), 'div-empty');
    await cancelEdit();
    // 使用真实输入事件覆盖触摸和鼠标；连续点击节点也只能选择，必须通过工具栏编辑。
    for (let attempt = 0; attempt < 2; attempt++) {
      await evaluate(`(${rowById('div-empty')}).scrollIntoView({ block: 'center' })`);
      const point = await evaluate(`(() => {
        const el = (${rowById('div-empty')}).querySelector('.luna-dom-viewer-tag-name');
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`);
      for (let click = 1; click <= 2; click++) {
        if (mode === 'desktop') {
          await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
          await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
        } else {
          await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
          await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
        assert.equal(await evaluate(`${editor}.hidden`), true, `${mode}：真实输入第 ${click} 次点击只选中`);
        assert.equal(await evaluate(`(${rowById('div-empty')}).classList.contains('luna-dom-viewer-selected')`), true, '节点点击保留选中反馈');
        if (click === 1) await sleep(600);
      }
      await realClick(`${root}.querySelector('.eruda-dom-edit-trigger')`);
      await waitFor(`!${editor}.hidden`);
      assert.equal(await evaluate(`${editor}.querySelector('.eruda-dom-edit-node').textContent`), '<div#div-empty>', '编辑按钮打开实际选中的空 div');
      assert.equal(await evaluate(`${root}.activeElement === ${editor}.querySelector('textarea')`), true, '编辑器获得输入焦点');
      await cancelEdit();
    }
    // 切换选择后，工具栏编辑当前节点。
    const selectOnly = async (expression) => {
      await evaluate(`(${expression}).click()`);
      assert.equal(await evaluate(`${editor}.hidden`), true, '切换编辑位置只选中');
    };
    await selectOnly(rowById('div-empty'));
    await selectOnly(rowById('div-nested'));
    await selectOnly(rowById('div-empty'));
    if (['desktop', 'legacy'].includes(mode)) {
      await mkdir(path('output/playwright'), { recursive: true });
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
      await writeFile(path(`output/playwright/elements-actions-${mode}.png`), Buffer.from(screenshot.data, 'base64'));
    }
    await realClick(`${root}.querySelector('.eruda-dom-edit-trigger')`);
    assert.equal(await evaluate(`${editor}.hidden`), false, '工具栏编辑按钮单击打开');
    assert.equal(await evaluate(`${editor}.querySelector('.eruda-dom-edit-node').textContent`), '<div#div-empty>');
    await cancelEdit();
    await selectOnly(rowById('div-empty'));
    await clickTab('console');
    await clickTab('elements');
    await openRow(rowById('div-empty'), 'div-empty');
    await cancelEdit();
    await selectOnly(rowById('div-parent'));
    await evaluate(`(${rowById('div-parent')}).querySelector('.luna-dom-viewer-toggle').click()`);
    await openRow(rowById('div-parent'), 'div-parent');
    await cancelEdit();
    await expandRow(rowById('div-parent'));
    await expandRow(rowById('div-nested'));
    const anonymousRow = `(${rowById('div-nested')}).nextElementSibling.querySelector('.luna-dom-viewer-tree-item')`;
    await openRow(anonymousRow, '');
    await editValue('<div data-edited="yes">编辑无属性 div</div>');
    await applyEdit();
    assert.equal(await evaluate(`document.querySelector('#div-nested > div').dataset.edited`), 'yes');
    const endRow = `Array.from((${rowById('div-nested')}).nextElementSibling.children).find(el => el.querySelector('.luna-dom-viewer-tag-name')?.textContent === '/div')`;
    await openRow(endRow, 'div-nested');
    await cancelEdit();
    await openRow(rowById('div-dynamic'), 'div-dynamic');
    await cancelEdit();
    await evaluate(`document.querySelector('#div-dynamic').outerHTML = '<div id="div-dynamic" data-new="true">更新后</div>'`);
    await waitFor(`(${rowById('div-dynamic')}).textContent.includes('data-new')`);
    assert.deepEqual(errors, [], '页面替换选中的 div 后，DOM 树继续正常工作');
    await openRow(rowById('div-dynamic'), 'div-dynamic');
    assert.match(await evaluate(`${editor}.querySelector('textarea').value`), /更新后/);
    await cancelEdit();
    await expandRow(rowById('div-shadow'));
    const shadowRow = `(${rowById('div-shadow')}).nextElementSibling.querySelector('.luna-dom-viewer-tree-item')`;
    await expandRow(shadowRow);
    await openRow(rowById('shadow-child'), 'shadow-child');
    await evaluate(`${editor}.querySelector('[data-mode="text"]').click()`);
    await editValue('Shadow DOM 修改成功');
    await applyEdit();
    assert.equal(await evaluate(`document.querySelector('#div-shadow').shadowRoot.querySelector('div').textContent`), 'Shadow DOM 修改成功');
    await selectOnly(`(${targetRow}).querySelector('.luna-dom-viewer-tag-name')`);
    await selectOnly(`(${targetRow}).querySelector('.luna-dom-viewer-attribute-name')`);
    await selectOnly(`(${targetRow}).querySelector('.luna-dom-viewer-tag-name')`);
    await clickAttribute('data-note');
    assert.equal(await evaluate(`${editor}.hidden`), false, '点击属性两次打开编辑器');
    assert.equal(await evaluate(`${editor}.querySelector('input').value`), 'data-note', '切换属性后编辑新选中的属性');
    await editValue('after');
    await applyEdit();
    assert.equal(await evaluate(`document.querySelector('#dom-edit-target').getAttribute('data-note')`), 'after');
    await evaluate(`document.querySelector('#dom-edit-target').click()`);
    assert.equal(await evaluate('window.fixtureEditClicks'), 1, '属性编辑保留节点事件监听');
    await waitFor(`(${targetRow}).textContent.includes('after')`);
    await clickAttribute('data-note');
    await evaluate(`${editor}.querySelector('input').value = 'data-state'`);
    await editValue('');
    await applyEdit();
    assert.equal(await evaluate(`document.querySelector('#dom-edit-target').getAttribute('data-state')`), '', '空属性值与删除区分');
    assert.equal(await evaluate(`document.querySelector('#dom-edit-target').hasAttribute('data-note')`), false);
    await waitFor(`(${targetRow}).textContent.includes('data-state')`);
    await clickAttribute('data-state');
    await evaluate(`${editor}.querySelector('[data-action="delete"]').click()`);
    assert.equal(await evaluate(`document.querySelector('#dom-edit-target').hasAttribute('data-state')`), false);
    await evaluate(`(${targetRow}).querySelector('.luna-dom-viewer-toggle').click()`);
    await waitFor(`Array.from(${row}).some(el => el.querySelector('.luna-dom-viewer-text-node')?.textContent === '原始文字')`);
    await openEditor(`Array.from(${row}).find(el => el.querySelector('.luna-dom-viewer-text-node')?.textContent === '原始文字').querySelector('.luna-dom-viewer-text-node')`);
    await editValue('编辑后的文字 <不是HTML>');
    await applyEdit();
    assert.equal(await evaluate(`document.querySelector('#dom-edit-target').textContent`), '编辑后的文字 <不是HTML>');
    assert.equal(await evaluate(`document.querySelector('#dom-edit-target').children.length`), 0);
    await openEditor(`(${targetRow}).querySelector('.luna-dom-viewer-tag-name')`);
    assert.equal(await evaluate(`${editor}.querySelector('[data-mode="html"]').getAttribute('aria-pressed')`), 'true');
    const syntaxSource = '<div title="属性 > 中文 &amp;">\n<!-- 注释 -->\n<img src="https://offline-probe.invalid/highlight.png" onerror="window.highlightExecuted=true">\n&lt;文字&gt;\n</div>\n';
    await editValue(syntaxSource);
    assert.deepEqual(await evaluate(`Array.from(${editor}.querySelectorAll('code span')).map(el => el.className).filter((value, index, all) => all.indexOf(value) === index).sort()`),
      ['syntax-attribute', 'syntax-comment', 'syntax-entity', 'syntax-string', 'syntax-tag']);
    assert.equal(await evaluate(`${editor}.querySelector('code img') === null && !window.highlightExecuted`), true, '高亮仅显示源码，不创建输入中的资源或执行事件');
    const geometry = await evaluate(`(() => {
      const textarea = ${editor}.querySelector('textarea'); const pre = ${editor}.querySelector('pre');
      return ['fontFamily','fontSize','lineHeight','letterSpacing','paddingLeft','paddingTop','whiteSpace','tabSize'].map(key => [getComputedStyle(textarea)[key], getComputedStyle(pre)[key]]);
    })()`);
    for (const [input, display] of geometry) assert.equal(input, display, '高亮层与输入层排版一致');
    const theme = await evaluate(`${editor}.dataset.theme`);
    await evaluate(`${editor}.dataset.theme = 'light'`);
    const light = await evaluate(`getComputedStyle(${editor}.querySelector('.syntax-tag')).color`);
    await evaluate(`${editor}.dataset.theme = 'dark'`);
    assert.notEqual(await evaluate(`getComputedStyle(${editor}.querySelector('.syntax-tag')).color`), light, '深色主题使用独立高亮颜色');
    await evaluate(`${editor}.dataset.theme = ${JSON.stringify(theme)}`);
    await evaluate(`(() => { const input = ${editor}.querySelector('textarea'); input.focus(); input.setSelectionRange(0,0); })()`);
    await cdp('Input.insertText', { text: '中文输入' });
    await waitFor(`${editor}.querySelector('code').textContent.startsWith('中文输入')`);
    assert.equal(await evaluate(`${editor}.querySelector('textarea').selectionStart`), 4, '着色不重置中文输入后的光标');
    await editValue('<div>\n' + ('\t<span>' + '长行'.repeat(100) + '</span>\n').repeat(50) + '</div>\n');
    await evaluate(`(() => { const input = ${editor}.querySelector('textarea'); input.scrollTop = 240; input.scrollLeft = 120; input.dispatchEvent(new Event('scroll')); })()`);
    assert.equal(await evaluate(`(() => {
      const input = ${editor}.querySelector('textarea'); const code = ${editor}.querySelector('code');
      const matrix = new DOMMatrix(getComputedStyle(code).transform);
      return input.scrollTop > 0 && input.scrollLeft > 0 && matrix.m41 === -input.scrollLeft && matrix.m42 === -input.scrollTop;
    })()`), true, '长行、换行和缩进的高亮随输入区双向滚动');
    await evaluate(`${editor}.querySelector('[data-mode="text"]').click()`);
    await editValue('<不是 HTML>&amp;');
    assert.equal(await evaluate(`${editor}.querySelectorAll('code span').length`), 0, '纯文本模式不将内容误识别为 HTML');
    await evaluate(`${editor}.querySelector('[data-mode="html"]').click()`);
    await editValue('<article id="dom-edit-target">\n  <strong>修改结构成功</strong>\n</article>');
    if (mode === 'legacy') {
      await mkdir(path('output/playwright'), { recursive: true });
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
      await writeFile(path('output/playwright/elements-editor.png'), Buffer.from(screenshot.data, 'base64'));
    }
    await applyEdit();
    assert.equal(await evaluate(`document.querySelector('#dom-edit-target').tagName`), 'ARTICLE');
    assert.equal(await evaluate(`document.querySelector('#dom-edit-target strong').textContent`), '修改结构成功');
    await waitFor(`(${targetRow}).textContent.includes('article')`);
    await openEditor(`(${targetRow}).querySelector('.luna-dom-viewer-tag-name')`);
    await editValue('<img src="https://offline-probe.invalid/editor-preview.png"><b>无效的多根节点</b>');
    await applyEdit();
    assert.match(await evaluate(`${editor}.querySelector('[role="alert"]').textContent`), /一个完整/);
    await cancelEdit();
    assert.equal(await evaluate(`document.querySelector('#dom-edit-target').tagName`), 'ARTICLE', '取消和无效输入不修改页面');
    await openEditor(`(${targetRow}).querySelector('.luna-dom-viewer-tag-name')`);
    await evaluate(`document.querySelector('#dom-edit-target').setAttribute('data-external', 'updated')`);
    await editValue('<p id="dom-edit-target">过期编辑</p>');
    await applyEdit();
    assert.match(await evaluate(`${editor}.querySelector('[role="alert"]').textContent`), /页面已更新/);
    await cancelEdit();
    await checkElements({ evaluate, waitFor, editor, rowById, expandRow, openEditor, editValue, applyEdit, cancelEdit,
      realClick,
      screenshot: async (name) => {
        if (!['desktop', 'legacy'].includes(mode)) return;
        await mkdir(path('output/playwright'), { recursive: true });
        const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
        await writeFile(path(`output/playwright/${name}-${mode}.png`), Buffer.from(screenshot.data, 'base64'));
      },
    });
    for (const tab of ['elements', 'network', 'sources', 'info', 'snippets', 'resources', 'settings', 'console']) {
      await clickTab(tab);
      await sleep(100);
    }
    assert.deepEqual(requests.slice(requestStart).filter((url) => !/^(data|blob):/.test(url)), [], '工具切换不得加载任何外部资源');
    await menu('显示悬浮球');
    assert.notEqual(await evaluate(entryDisplay), 'none');
    await assertEntryCentered();
    const entryPoint = await evaluate(`(() => {
      const rect = ${root}.querySelector('.eruda-entry-btn').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [entryPoint] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitFor(`document.querySelector('#eruda-offline-panel').dataset.panelOpen === 'false'`);
    await waitFor(`window.fixtureMenus.has('Eruda：打开调试面板')`);
    await menu('打开调试面板');
    assert.equal(await evaluate(`document.querySelector('#eruda-offline-panel').dataset.panelOpen`), 'true', '单菜单跟随原生浮球的实际开关状态');
    await menu('隐藏悬浮球');
    assert.equal(await evaluate(entryDisplay), 'none');
    await menu('显示悬浮球');
    await assertEntryCentered();
    await menu('隐藏悬浮球');
    assert.equal(await evaluate(entryDisplay), 'none', '居中修复不影响隐藏悬浮球');
    await menu('关闭调试面板');
    assert.notEqual(await evaluate('console.log === window.fixtureOriginalConsole'), true, '隐藏面板仍采集日志');
    await menu('停止本页');
    assert.equal(await evaluate(`Array.from(document.fonts).filter(font => font.family.startsWith('eruda-offline-')).length`), 0, '停止后释放本实例注册的字体');
    assert.equal(await evaluate(`!!document.querySelector('#eruda-offline-panel')`), false);
    assert.equal(await evaluate('console.log === window.fixtureCapturedConsole'), false, '停止后移除 console 采集包装');
    assert.equal(await evaluate('window.fetch === window.fixtureOriginalFetch'), true, '停止后恢复 fetch');
    await menu('打开调试面板');
    await waitFor(`!!document.querySelector('#eruda-offline-panel')`);
    await evaluate(`console.log('重新启动成功')`);
    await waitFor(`${root}.textContent.includes('重新启动成功')`);
    await evaluate('document.fonts.ready');
    await assertIconFont('.eruda-clear-console');
    await sleep(400);
    assert.equal(await evaluate(`getComputedStyle(${root}.querySelector('.eruda-dev-tools')).display`), 'block', '快速重开后保持可见');
    assert.equal(await evaluate(`getComputedStyle(${root}.querySelector('.eruda-dev-tools')).opacity`), '1');
    await checkConsoleLevels();
    if (mode === 'legacy') {
      await mkdir(path('output/playwright'), { recursive: true });
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
      await writeFile(path('output/playwright/offline-mobile.png'), Buffer.from(screenshot.data, 'base64'));
    }
    await menu('关闭自动采集');
    assert.equal(await evaluate(`window.fixtureMenus.has('Eruda：开启自动采集（下次加载生效）')`), true);
    await menu('开启自动采集');
    assert.deepEqual(await evaluate('window.fixtureAlerts'), [
      '[Eruda 离线调试]\n自动采集已关闭，下次加载页面生效。',
      '[Eruda 离线调试]\n自动采集已开启，下次加载页面生效。',
    ]);
    assert.equal(await evaluate('window.fixtureMenus.size'), 5, '反复更新后菜单数量不变');
    await menu('显示悬浮球');
    assert.notEqual(await evaluate(entryDisplay), 'none', '刷新前悬浮球已显示');
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('fixture:eruda-offline:preferences:v1')).hideEntry`), false, '刷新前偏好已写入存储');
    // Page.navigate 返回时旧文档仍可能可见，不能只用 readyState 判断刷新完成。
    await evaluate('window.fixturePreviousDocument = true');
    if (mode === 'csp') {
      await cdp('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    }
    await cdp('Page.navigate', { url });
    await waitFor(`window.fixturePreviousDocument !== true && document.readyState === 'complete' && !!document.querySelector('#eruda-offline-panel')?.shadowRoot`);
    // 文档加载完成不代表异步 GM 菜单与悬浮球状态已恢复；等待实际状态，仍在超时后报错。
    try {
      await waitFor(`JSON.parse(localStorage.getItem('fixture:eruda-offline:preferences:v1'))?.hideEntry === false
        && window.fixtureMenus.size === 5 && window.fixtureMenus.has('Eruda：隐藏悬浮球') && ${entryDisplay} !== 'none'`);
    } catch (error) {
      const state = await evaluate(`({ url: location.href, ready: document.readyState,
        preferences: localStorage.getItem('fixture:eruda-offline:preferences:v1'),
        menus: [...window.fixtureMenus.keys()], entry: ${root}.querySelector('.eruda-entry-btn').outerHTML,
        display: ${entryDisplay}, alerts: window.fixtureAlerts })`);
      throw new Error(`${mode}：刷新后悬浮球状态未恢复：${JSON.stringify(state)}`, { cause: error });
    }
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('fixture:eruda-offline:preferences:v1')).hideEntry`), false, '刷新后显示偏好仍保存在存储中');
    assert.notEqual(await evaluate(entryDisplay), 'none', '刷新后保留悬浮球偏好');
    await assertEntryCentered();
    await send('Target.disposeBrowserContext', { browserContextId });
    console.log(`✓ ${mode}：${mode === 'desktop' ? '桌面鼠标' : '手机触摸'}、div 点击及动态替换、断网 DOM 编辑、面板和浮球、停止后重开`);
  }
  assert.equal(errors.length, 0, `浏览器未处理错误：${errors.join(', ')}`);
  await send('Browser.close');
  console.log('浏览器验证全部通过。');
} finally {
  socket?.close();
  server?.close();
  browser.kill();
}
