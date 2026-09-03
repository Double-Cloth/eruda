import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/userscript.js', import.meta.url), 'utf8');

async function harness({ mode = 'legacy', saved = {}, frame = false, storageFails = false } = {}) {
  const menus = new Map();
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
    mockPage(options) { connected = true; statusEvent = `${options.channel}:status`; },
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
    registerMenuCommand: (label, callback) => { menus.set(label, callback); return menus.size; },
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
  return { menus, actions, alerts, saves, state, click };
}

for (const mode of ['legacy', 'modern']) {
  test(`${mode} GM API：菜单开关、悬浮球、停止后重开及持久化`, async () => {
    const h = await harness({ mode });
    assert.equal(h.menus.size, 6);
    assert.equal(h.state.initialized, true);
    await h.click('打开调试');
    assert.equal(h.state.visible, true);
    await h.click('关闭调试');
    assert.equal(h.state.visible, false);
    assert.equal(h.state.initialized, true);
    await h.click('显示 / 隐藏');
    assert.equal(h.state.hiddenEntry, false);
    assert.equal(h.saves.at(-1).value.hideEntry, false);
    await h.click('停止本页');
    assert.equal(h.state.initialized, false);
    await h.click('打开调试');
    assert.equal(h.state.initialized, true);
    await h.click('切换自动采集');
    assert.equal(h.saves.at(-1).value.autoStart, false);
  });
}

test('关闭自动采集时保持惰性，仍可手动打开', async () => {
  const h = await harness({ saved: { autoStart: false, hideEntry: true } });
  assert.equal(h.actions.length, 0);
  await h.click('打开调试');
  assert.equal(h.state.visible, true);
});

test('存储失败时菜单操作继续执行并说明仅本页生效', async () => {
  const h = await harness({ storageFails: true });
  await h.click('显示 / 隐藏');
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
