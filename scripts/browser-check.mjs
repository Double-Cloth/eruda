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
      errors.push(message.params.exceptionDetails.text);
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
  for (const mode of ['legacy', 'modern', 'injected', 'no-menu']) {
    const { browserContextId } = await send('Target.createBrowserContext');
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const cdp = (method, params) => send(method, params, sessionId);
    await cdp('Page.enable');
    await cdp('Runtime.enable');
    await cdp('Network.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
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
    await cdp('Page.navigate', { url });
    await waitFor(`document.readyState === 'complete' && !!document.querySelector('#eruda-offline-panel')?.shadowRoot`);
    const root = `document.querySelector('#eruda-offline-panel').shadowRoot`;
    assert.equal(await evaluate('window.eruda.sentinel'), true, '保留页面已有 Eruda');
    const entryDisplay = `getComputedStyle(${root}.querySelector('.eruda-entry-btn')).display`;
    if (mode === 'no-menu') {
      assert.notEqual(await evaluate(entryDisplay), 'none');
      await send('Target.disposeBrowserContext', { browserContextId });
      console.log(`✓ ${mode}：缺少菜单时浮球仍可触达`);
      continue;
    }
    assert.equal(await evaluate('window.fixtureMenus.size'), 6);
    await evaluate('window.fixtureCapturedConsole = console.log');
    assert.equal(await evaluate(entryDisplay), 'none');
    await menu('打开调试');
    await waitFor(`${root}.textContent.includes('body 阶段执行')`);
    await evaluate(`console.log('OFFLINE_PAGE_LOG', { answer: 42 }); fetch('data:application/json,%7B%22ok%22%3Atrue%7D').then(r => r.json())`);
    await waitFor(`${root}.textContent.includes('OFFLINE_PAGE_LOG')`);
    assert.notEqual(await evaluate('window.fetch === window.fixtureOriginalFetch'), true, '捕获页面 fetch');
    // 从此刻起浏览器断网；切换各面板不得触发 HTTP(S) 请求。
    await cdp('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    const requestStart = requests.length;
    const clickTab = async (name) => {
      await evaluate(`Array.from(${root}.querySelectorAll('.eruda-tab .luna-tab-item')).find(el => el.getAttribute('data-id') === ${JSON.stringify(name)}).click()`);
    };
    for (const tab of ['elements', 'network', 'sources', 'info', 'snippets', 'resources', 'settings', 'console']) {
      await clickTab(tab);
      await sleep(100);
    }
    assert.equal(requests.slice(requestStart).filter((url) => /^https?:/.test(url)).length, 0, '工具切换不得联网');
    await menu('显示 / 隐藏');
    assert.notEqual(await evaluate(entryDisplay), 'none');
    await menu('显示 / 隐藏');
    assert.equal(await evaluate(entryDisplay), 'none');
    await menu('关闭调试');
    assert.notEqual(await evaluate('console.log === window.fixtureOriginalConsole'), true, '隐藏面板仍采集日志');
    await menu('停止本页');
    assert.equal(await evaluate(`!!document.querySelector('#eruda-offline-panel')`), false);
    assert.equal(await evaluate('console.log === window.fixtureCapturedConsole'), false, '停止后移除 console 采集包装');
    assert.equal(await evaluate('window.fetch === window.fixtureOriginalFetch'), true, '停止后恢复 fetch');
    await menu('打开调试');
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
    await send('Target.disposeBrowserContext', { browserContextId });
    console.log(`✓ ${mode}：手机视口、页面日志、请求捕获、断网切换、浮球、停止和重新启动`);
  }
  assert.equal(errors.length, 0, `浏览器未处理错误：${errors.join(', ')}`);
  await send('Browser.close');
  console.log('浏览器验证全部通过。');
} finally {
  socket?.close();
  browser.kill();
}
