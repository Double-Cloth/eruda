import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { path } from './lib.mjs';

// 使用 Node 内置 WebSocket 和 Chrome DevTools Protocol，不增加 npm 依赖。
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
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
const browser = spawn(findChrome(), [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--disable-extensions', 'about:blank',
], { stdio: 'ignore', windowsHide: true });
let launchError;
browser.on('error', (error) => { launchError = error; });
let socket;

try {
  let portInfo;
  for (let i = 0; i < 150; i++) {
    if (launchError) throw launchError;
    try { portInfo = await readFile(join(profile, 'DevToolsActivePort'), 'utf8'); break; }
    catch { await sleep(100); }
  }
  if (!portInfo) throw new Error('浏览器启动超时。');
  const [port, endpoint] = portInfo.trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
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
  const url = pathToFileURL(path('tests/fixtures/page.html')).href;
  for (const mode of ['desktop', 'legacy', 'modern', 'injected', 'no-menu']) {
    const { browserContextId } = await send('Target.createBrowserContext');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const cdp = (method, params) => send(method, params, sessionId);
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Network.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: mode === 'desktop' ? 1280 : 390, height: 844, deviceScaleFactor: 1, mobile: mode !== 'desktop' });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: mode !== 'desktop' });
    let adapter = '';
    if (mode === 'modern') adapter = `
      window.GM = Object.fromEntries(['getValue', 'setValue', 'registerMenuCommand'].map(name => {
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
    assert.deepEqual(requests.slice(startupStart).filter((request) => request !== url && !/^(data|blob):/.test(request)), [], '启动仅加载测试页面和内嵌资源');
    const root = `document.querySelector('#eruda-offline-panel').shadowRoot`;
    assert.equal(await evaluate('window.eruda.sentinel'), true, '保留页面已有 Eruda');
    const entryDisplay = `getComputedStyle(${root}.querySelector('.eruda-entry-btn')).display`;
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
    await menu('打开 / 关闭');
    await waitFor(`${root}.textContent.includes('body 阶段执行')`);
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
    const clickAttribute = async (name) => evaluate(`Array.from((${targetRow}).querySelectorAll('.luna-dom-viewer-attribute-name')).find(el => el.textContent === ${JSON.stringify(name)}).click()`);
    await ensureFixtureVisible();
    const rowById = (id) => `Array.from(${row}).find(el => Array.from(el.querySelectorAll('.luna-dom-viewer-attribute-value')).some(attr => attr.textContent === ${JSON.stringify(id)}))`;
    const expandRow = async (expression) => {
      await evaluate(`(() => { const el = (${expression}); if (!el.classList.contains('luna-dom-viewer-expanded')) el.querySelector('.luna-dom-viewer-toggle').click(); })()`);
      assert.equal(await evaluate(`${editor}.hidden`), true, '展开箭头不打开编辑器');
    };
    const openRow = async (expression, expectedId) => {
      await evaluate(`(${expression}).click()`);
      assert.equal(await evaluate(`${editor}.hidden`), false, `${mode}：div 点击应打开编辑器`);
      assert.equal(await evaluate(`${editor}.querySelector('.eruda-dom-edit-node').textContent`), `<div${expectedId ? '#' + expectedId : ''}>`, '编辑点击的 div，不沿用旧选择');
    };
    await expandRow(rowById('div-parent'));
    await openRow(rowById('div-empty'), 'div-empty');
    await cancelEdit();
    // 使用真实输入事件覆盖触摸和鼠标，检查第一次及重复点击。
    for (let attempt = 0; attempt < 2; attempt++) {
      await evaluate(`(${rowById('div-empty')}).scrollIntoView({ block: 'center' })`);
      const point = await evaluate(`(() => {
        const el = (${rowById('div-empty')}).querySelector('.luna-dom-viewer-tag-name');
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`);
      if (mode === 'desktop') {
        await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      } else {
        await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await waitFor(`!${editor}.hidden`);
      assert.equal(await evaluate(`${editor}.querySelector('.eruda-dom-edit-node').textContent`), '<div#div-empty>', '实际点击空 div 可重复打开编辑器');
      assert.equal(await evaluate(`${root}.activeElement === ${editor}.querySelector('textarea')`), true, '编辑器获得输入焦点');
      await cancelEdit();
    }
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
    await clickAttribute('data-note');
    assert.equal(await evaluate(`${editor}.hidden`), false, '点击属性直接打开编辑器');
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
    await evaluate(`Array.from(${row}).find(el => el.querySelector('.luna-dom-viewer-text-node')?.textContent === '原始文字').querySelector('.luna-dom-viewer-text-node').click()`);
    await editValue('编辑后的文字 <不是HTML>');
    await applyEdit();
    assert.equal(await evaluate(`document.querySelector('#dom-edit-target').textContent`), '编辑后的文字 <不是HTML>');
    assert.equal(await evaluate(`document.querySelector('#dom-edit-target').children.length`), 0);
    await evaluate(`(${targetRow}).querySelector('.luna-dom-viewer-tag-name').click()`);
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
    await evaluate(`(${targetRow}).querySelector('.luna-dom-viewer-tag-name').click()`);
    await editValue('<img src="https://offline-probe.invalid/editor-preview.png"><b>无效的多根节点</b>');
    await applyEdit();
    assert.match(await evaluate(`${editor}.querySelector('[role="alert"]').textContent`), /一个完整/);
    await cancelEdit();
    assert.equal(await evaluate(`document.querySelector('#dom-edit-target').tagName`), 'ARTICLE', '取消和无效输入不修改页面');
    await evaluate(`(${targetRow}).querySelector('.luna-dom-viewer-tag-name').click()`);
    await evaluate(`document.querySelector('#dom-edit-target').setAttribute('data-external', 'updated')`);
    await editValue('<p id="dom-edit-target">过期编辑</p>');
    await applyEdit();
    assert.match(await evaluate(`${editor}.querySelector('[role="alert"]').textContent`), /页面已更新/);
    await cancelEdit();
    for (const tab of ['elements', 'network', 'sources', 'info', 'snippets', 'resources', 'settings', 'console']) {
      await clickTab(tab);
      await sleep(100);
    }
    assert.deepEqual(requests.slice(requestStart).filter((url) => !/^(data|blob):/.test(url)), [], '工具切换不得加载任何外部资源');
    await menu('显示 / 隐藏');
    assert.notEqual(await evaluate(entryDisplay), 'none');
    await assertEntryCentered();
    const entryPoint = await evaluate(`(() => {
      const rect = ${root}.querySelector('.eruda-entry-btn').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [entryPoint] });
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await waitFor(`document.querySelector('#eruda-offline-panel').dataset.panelOpen === 'false'`);
    await menu('打开 / 关闭');
    assert.equal(await evaluate(`document.querySelector('#eruda-offline-panel').dataset.panelOpen`), 'true', '单菜单跟随原生浮球的实际开关状态');
    await menu('显示 / 隐藏');
    assert.equal(await evaluate(entryDisplay), 'none');
    await menu('显示 / 隐藏');
    await assertEntryCentered();
    await menu('显示 / 隐藏');
    assert.equal(await evaluate(entryDisplay), 'none', '居中修复不影响隐藏悬浮球');
    await menu('打开 / 关闭');
    assert.notEqual(await evaluate('console.log === window.fixtureOriginalConsole'), true, '隐藏面板仍采集日志');
    await menu('停止本页');
    assert.equal(await evaluate(`!!document.querySelector('#eruda-offline-panel')`), false);
    assert.equal(await evaluate('console.log === window.fixtureCapturedConsole'), false, '停止后移除 console 采集包装');
    assert.equal(await evaluate('window.fetch === window.fixtureOriginalFetch'), true, '停止后恢复 fetch');
    await menu('打开 / 关闭');
    await waitFor(`!!document.querySelector('#eruda-offline-panel')`);
    await evaluate(`console.log('重新启动成功')`);
    await waitFor(`${root}.textContent.includes('重新启动成功')`);
    await sleep(400);
    assert.equal(await evaluate(`getComputedStyle(${root}.querySelector('.eruda-dev-tools')).display`), 'block', '快速重开后保持可见');
    assert.equal(await evaluate(`getComputedStyle(${root}.querySelector('.eruda-dev-tools')).opacity`), '1');
    if (mode === 'legacy') {
      await mkdir(path('output/playwright'), { recursive: true });
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png' });
      await writeFile(path('output/playwright/offline-mobile.png'), Buffer.from(screenshot.data, 'base64'));
    }
    await menu('显示 / 隐藏');
    await cdp('Page.navigate', { url });
    await waitFor(`document.readyState === 'complete' && !!document.querySelector('#eruda-offline-panel')?.shadowRoot`);
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
  browser.kill();
}
