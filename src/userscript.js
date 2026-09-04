(function () {
  'use strict';
  if (window.top !== window.self) return;

  const VERSION = '__SCRIPT_VERSION__';
  const ERUDA_VERSION = '__ERUDA_VERSION__';
  const STORAGE_KEY = 'eruda-offline:preferences:v1';
  const channel = `eruda-offline:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const preferences = { hideEntry: true, autoStart: true };
  let status = { initialized: false, visible: false, hiddenEntry: true, error: '' };
  let bridge;
  let ready;
  let queue = Promise.resolve();
  let storageWarning = '';
  let menus = [];
  let registeredMenus = [];
  let menuQueue = Promise.resolve();

  function api(legacy, modern) {
    if (typeof legacy === 'function') return legacy;
    if (typeof GM !== 'undefined' && typeof GM[modern] === 'function') return GM[modern].bind(GM);
    return null;
  }

  const getValue = api(typeof GM_getValue === 'function' ? GM_getValue : null, 'getValue');
  const setValue = api(typeof GM_setValue === 'function' ? GM_setValue : null, 'setValue');
  const registerMenu = api(typeof GM_registerMenuCommand === 'function' ? GM_registerMenuCommand : null, 'registerMenuCommand');
  const unregisterMenu = api(typeof GM_unregisterMenuCommand === 'function' ? GM_unregisterMenuCommand : null, 'unregisterMenuCommand');
  const addElement = api(typeof GM_addElement === 'function' ? GM_addElement : null, 'addElement');

  function notify(message) { window.alert(`[Eruda 离线调试]\n${message}`); }

  async function save() {
    try {
      if (!setValue) throw new Error('脚本管理器没有提供存储 API');
      await setValue(STORAGE_KEY, { ...preferences });
      storageWarning = '';
    } catch (error) {
      storageWarning = `设置仅在本页有效：${error.message}`;
      notify(storageWarning);
    }
  }

  function documentReady() {
    if (document.documentElement && document.head) return Promise.resolve();
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (document.documentElement && document.head) { observer.disconnect(); resolve(); }
      });
      observer.observe(document, { childList: true, subtree: true });
    });
  }

  /* PAGE_MAIN */

  async function connect() {
    await documentReady();
    if (document.getElementById('eruda-offline-bridge')) {
      throw new Error('当前页面已有本脚本实例，请禁用重复安装的副本并刷新页面。');
    }
    const options = { channel, version: VERSION, hideEntry: preferences.hideEntry };
    // Tampermonkey raw / Violentmonkey page 模式可直接执行，避免内联脚本受 CSP 限制。
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow === window) {
      pageMain(options);
    } else {
      const textContent = `;(${pageMain.toString()})(${JSON.stringify(options)});`;
      let script;
      if (addElement) {
        try {
          script = await addElement('script', { textContent });
        } catch (error) { console.warn('[Eruda 离线调试] GM_addElement 不可用：', error); }
        script?.remove();
      }
      if (!document.getElementById('eruda-offline-bridge')) {
        script = document.createElement('script');
        script.textContent = textContent;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
      }
    }
    bridge = document.getElementById('eruda-offline-bridge');
    if (!bridge) {
      throw new Error('页面环境注入被浏览器或 CSP 阻止。请在脚本管理器中允许页面环境注入，然后刷新。');
    }
    bridge.addEventListener(`${channel}:status`, (event) => {
      try { status = JSON.parse(event.detail); } catch { /* 忽略不符合协议的页面事件。 */ }
      refreshMenus();
    });
    send('status');
  }

  function send(action, data = {}) {
    bridge.dispatchEvent(new CustomEvent(`${channel}:command`, {
      detail: JSON.stringify({ action, ...data }),
    }));
    if (status.error) throw new Error(status.error);
  }

  async function ensureConnected() {
    if (!ready) ready = connect().catch((error) => { ready = null; throw error; });
    await ready;
  }

  async function command(action, data) {
    await ensureConnected();
    send(action, data);
  }

  function run(action) {
    queue = queue.then(action).catch((error) => {
      console.error('[Eruda 离线调试]', error);
      notify(error.message || String(error));
    }).then(() => refreshMenus());
    return queue;
  }

  function refreshMenus() {
    // 菜单 API 可能异步完成，串行更新以免页面事件与菜单操作留下重复项。
    menuQueue = menuQueue.then(async () => {
      if (!registerMenu) return 0;
      const labels = menus.map(([label]) => label());
      if (registeredMenus.length === labels.length &&
        registeredMenus.every((menu, index) => menu.label === labels[index])) return registeredMenus.length;
      // 不支持注销的管理器保留已有入口，避免每次状态变化都累积菜单。
      if (registeredMenus.length && !unregisterMenu) return registeredMenus.length;
      while (registeredMenus.length) {
        await unregisterMenu(registeredMenus[0].id);
        registeredMenus.shift();
      }
      for (const [index, [, action]] of menus.entries()) {
        try {
          const id = await registerMenu(labels[index], () => run(action));
          registeredMenus.push({ id, label: labels[index] });
        } catch (error) { console.warn('[Eruda 离线调试] 无法注册菜单：', error); }
      }
      return registeredMenus.length;
    }).catch((error) => {
      console.warn('[Eruda 离线调试] 无法更新菜单：', error);
      return registeredMenus.length;
    });
    return menuQueue;
  }

  async function main() {
    try {
      const saved = getValue ? await getValue(STORAGE_KEY, {}) : {};
      for (const key of Object.keys(preferences)) {
        if (typeof saved?.[key] === 'boolean') preferences[key] = saved[key];
      }
    } catch (error) { storageWarning = `无法读取设置：${error.message}`; }

    menus = [
      [() => `Eruda：${status.visible ? '关闭' : '打开'}调试面板`, () => command('toggle')],
      [() => `Eruda：${status.initialized && !status.hiddenEntry ? '隐藏' : '显示'}悬浮球`, async () => {
        preferences.hideEntry = status.initialized && !status.hiddenEntry;
        await save();
        await command('entry', { hidden: preferences.hideEntry });
        if (!preferences.hideEntry) await command('start');
      }],
      [() => `Eruda：${preferences.autoStart ? '关闭' : '开启'}自动采集（下次加载生效）`, async () => {
        preferences.autoStart = !preferences.autoStart;
        await save();
        notify(`自动采集已${preferences.autoStart ? '开启' : '关闭'}，下次加载页面生效。`);
      }],
      [() => 'Eruda：停止本页调试并释放资源', () => command('stop')],
      [() => 'Eruda：查看状态与版本', async () => {
        if (bridge) await command('status');
        notify(`脚本 ${VERSION}\nEruda ${ERUDA_VERSION}\n采集：${status.initialized ? '运行中' : '已停止'}\n面板：${status.visible ? '打开' : '关闭'}\n悬浮球：${preferences.hideEntry ? '隐藏' : '显示'}\n自动采集：${preferences.autoStart ? '开启' : '关闭'}${storageWarning ? `\n${storageWarning}` : ''}`);
      }],
    ];
    const menuCount = await refreshMenus();
    // 缺少菜单 API 时保留可触达的入口，防止默认隐藏导致无法打开面板。
    if (!menuCount) preferences.hideEntry = false;
    if (preferences.autoStart || !menuCount) {
      try { await command('start'); }
      catch (error) {
        // 自动启动失败只记录错误，用户点菜单时再展示提示，避免每页弹窗。
        status.error = String(error.message || error);
        console.error('[Eruda 离线调试]', error);
      }
    }
    await refreshMenus();
  }

  queue = main().catch((error) => console.error('[Eruda 离线调试]', error));
})();
