import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/userscript.js', import.meta.url), 'utf8');

async function harness({ mode = 'legacy', saved = {}, frame = false, storageFails = false } = {}) {
  const menus = new Map();
  const menuIds = new Map();
  let nextMenuId = 0;
  const actions = [];
  const alerts = [];
  const saves = [];
  const listeners = new Map();
  const state = { initialized: false, visible: false, hiddenEntry: true, error: '' };
  let connected = false;
  let statusEvent;
  const bridge = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    dispatchEvent(event) {
      const command = JSON.parse(event.detail);
      actions.push(command.action);
      if (command.action === 'toggle') { state.initialized = true; state.visible = !state.visible; }
      if (command.action === 'show' || command.action === 'start') state.initialized = true;
      if (command.action === 'show') state.visible = true;
      if (command.action === 'hide') state.visible = false;
      if (command.action === 'stop') { state.visible = false; state.initialized = false; }
      if (command.action === 'entry') state.hiddenEntry = command.hidden;
      listeners.get(statusEvent)?.({ detail: JSON.stringify(state) });
    },
  };
  const sandbox = {
    console: { error() {}, warn() {} },
    document: { head: {}, documentElement: {}, getElementById: () => connected ? bridge : null },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    alert: (message) => alerts.push(message),
    mockPage(options) { connected = true; state.hiddenEntry = options.hideEntry; statusEvent = `${options.channel}:status`; },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = frame ? {} : sandbox;
  sandbox.unsafeWindow = sandbox;
  const api = {
    getValue: () => saved,
    setValue: (key, value) => {
      if (storageFails) throw new Error('存储被禁用');
      saves.push({ key, value });
    },
    registerMenuCommand: (label, callback) => {
      const id = nextMenuId++;
      menuIds.set(id, label);
      menus.set(label, callback);
      return id;
    },
    unregisterMenuCommand: (id) => { menus.delete(menuIds.get(id)); menuIds.delete(id); },
  };
  if (mode === 'legacy') {
    for (const [name, fn] of Object.entries(api)) sandbox[`GM_${name}`] = fn;
  } else if (mode === 'modern') {
    sandbox.GM = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, async (...args) => fn(...args)]));
  }
  const context = vm.createContext(sandbox);
  new vm.Script(source.replace('/* PAGE_MAIN */', 'function pageMain(options) { mockPage(options); }')).runInContext(context);
  await new Promise(setImmediate);
  const click = async (contains) => {
    const entry = [...menus].find(([label]) => label.includes(contains));
    assert.ok(entry, `菜单应存在：${contains}`);
    await entry[1]();
  };
  const report = async (changes) => {
    Object.assign(state, changes);
    listeners.get(statusEvent)?.({ detail: JSON.stringify(state) });
    await new Promise(setImmediate);
  };
  return { menus, actions, alerts, saves, state, click, report };
}

for (const mode of ['legacy', 'modern']) {
  test(`${mode} GM API：菜单开关、悬浮球、停止后重开及持久化`, async () => {
    const h = await harness({ mode });
    assert.equal(h.menus.size, 5);
    assert.equal(h.state.initialized, true);
    await h.click('打开调试面板');
    assert.equal(h.state.visible, true);
    await h.click('关闭调试面板');
    assert.equal(h.state.visible, false);
    assert.equal(h.state.initialized, true);
    await h.click('显示悬浮球');
    assert.equal(h.state.hiddenEntry, false);
    assert.equal(h.saves.at(-1).value.hideEntry, false);
    await h.click('隐藏悬浮球');
    assert.equal(h.state.hiddenEntry, true);
    await h.click('显示悬浮球');
    await h.click('停止本页');
    assert.equal(h.state.initialized, false);
    assert.ok(h.menus.has('Eruda：显示悬浮球'));
    await h.click('打开调试面板');
    assert.equal(h.state.initialized, true);
    await h.click('关闭自动采集');
    assert.equal(h.saves.at(-1).value.autoStart, false);
    await h.click('开启自动采集');
    assert.equal(h.saves.at(-1).value.autoStart, true);
    assert.equal(h.menus.size, 5, '状态更新后不留下重复菜单');
  });

  test(`${mode} GM API：原生面板事件更新菜单，重复状态不重新注册`, async () => {
    const h = await harness({ mode });
    await h.report({ visible: true });
    assert.ok(h.menus.has('Eruda：关闭调试面板'));
    assert.equal(h.menus.has('Eruda：打开调试面板'), false);
    const callback = h.menus.get('Eruda：关闭调试面板');
    await h.report({ visible: true });
    assert.equal(h.menus.get('Eruda：关闭调试面板'), callback);
    await h.report({ visible: false });
    assert.ok(h.menus.has('Eruda：打开调试面板'));
    assert.equal(h.menus.size, 5);
  });

  test(`${mode} GM API：停止后可通过显示悬浮球重新启动`, async () => {
    const h = await harness({ mode, saved: { hideEntry: false } });
    await h.click('隐藏悬浮球');
    await h.click('显示悬浮球');
    await h.click('停止本页');
    await h.click('显示悬浮球');
    assert.equal(h.state.initialized, true);
    assert.equal(h.state.hiddenEntry, false);
    assert.ok(h.menus.has('Eruda：隐藏悬浮球'));
  });
}

test('关闭自动采集时保持惰性，仍可手动打开', async () => {
  const h = await harness({ saved: { autoStart: false, hideEntry: true } });
  assert.equal(h.actions.length, 0);
  assert.ok(h.menus.has('Eruda：开启自动采集（下次加载生效）'));
  await h.click('打开调试面板');
  assert.equal(h.state.visible, true);
});

test('存储失败时菜单操作继续执行并说明仅本页生效', async () => {
  const h = await harness({ storageFails: true });
  await h.click('显示悬浮球');
  assert.equal(h.state.hiddenEntry, false);
  assert.match(h.alerts[0], /仅在本页有效/);
});

test('无菜单 API 时仍启动调试入口；iframe 不重复运行', async () => {
  const h = await harness({ mode: 'none', saved: { autoStart: false } });
  assert.ok(h.actions.includes('start'));
  const frame = await harness({ frame: true });
  assert.equal(frame.actions.length, 0);
  assert.equal(frame.menus.size, 0);
});
