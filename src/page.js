function pageMain(options) {
  'use strict';

  // 此函数整体运行于页面环境，内嵌模块不会覆盖页面已有的 window.eruda。
  if (document.getElementById('eruda-offline-bridge')) return;
  const bridge = document.createElement('span');
  bridge.id = 'eruda-offline-bridge';
  bridge.hidden = true;
  document.documentElement.appendChild(bridge);
  const commandEvent = `${options.channel}:command`;
  const statusEvent = `${options.channel}:status`;
  let eruda;
  let container;
  let initialized = false;
  let visible = false;
  let hiddenEntry = options.hideEntry;
  let outline;
  let networkHooks = [];
  let errorMessage = '';

  function report() {
    bridge.dispatchEvent(new CustomEvent(statusEvent, {
      detail: JSON.stringify({ initialized, visible, hiddenEntry, error: errorMessage }),
    }));
  }

  function loadEruda() {
    const targets = [[window, 'fetch'], [window, 'WebSocket'],
      ...['open', 'send', 'setRequestHeader'].map((key) => [window.XMLHttpRequest.prototype, key])];
    networkHooks = targets.map(([target, key]) => ({ target, key, original: target[key] }));
    const module = { exports: {} };
    (function (module, exports, define) {
      /* ERUDA_VENDOR */
    }).call(window, module, module.exports, undefined);
    for (const hook of networkHooks) hook.wrapped = hook.target[hook.key];
    return module.exports;
  }

  function restoreNetwork() {
    // 上游 destroy 不会撤销 Chobitsu 网络包装；只恢复仍由本实例控制的方法。
    for (const hook of networkHooks) {
      if (hook.target[hook.key] === hook.wrapped) hook.target[hook.key] = hook.original;
    }
  }

  function applyEntry() {
    if (!initialized) return;
    const entry = eruda.get('entryBtn');
    hiddenEntry ? entry.hide() : entry.show();
  }

  function configureOfflineTools() {
    const sources = eruda.get('sources');
    const setSource = sources.set.bind(sources);
    const showSource = sources.show.bind(sources);
    const hideSource = sources.hide.bind(sources);
    let hasSource = false;
    // 上游 Sources 默认会重新请求当前页面；这里改为展示现有 DOM 快照。
    sources.set = (type, value) => {
      hasSource = true;
      if (type === 'iframe' || type === 'img') {
        return setSource('raw', `资源地址：${value}\n离线模式不重新加载图片或 iframe。请在 Elements 中检查已加载的节点。`);
      }
      return setSource(type, value);
    };
    sources.show = () => {
      if (!hasSource) sources.set('html', document.documentElement.outerHTML);
      return showSource();
    };
    sources.hide = () => { hasSource = false; return hideSource(); };

    // 原生 Resources 会创建远程图片预览并下载脚本，替换为读取页面现有数据的面板。
    eruda.add({
      name: 'resources',
      init($el) { this.element = $el.get(0); },
      show() { this.element.style.display = 'block'; this.render(); },
      hide() { this.element.style.display = 'none'; },
      destroy() { this.element.replaceChildren(); },
      render() {
        const root = this.element;
        root.replaceChildren();
        root.style.cssText = 'display:block;padding:12px;overflow:auto;overflow-wrap:anywhere;font-size:13px;line-height:1.6;';
        const text = (tag, content, parent = root) => {
          const element = document.createElement(tag);
          element.textContent = content;
          parent.appendChild(element);
          return element;
        };
        const button = (label, action, parent = root) => {
          const element = text('button', label, parent);
          element.style.cssText = 'margin:4px;padding:6px 10px;border:1px solid currentColor;border-radius:4px;cursor:pointer;';
          element.addEventListener('click', () => {
            try { action(); } catch (error) { window.alert(error.message); }
          });
        };
        const view = (type, value) => { sources.set(type, value); eruda.show('sources'); };
        text('p', '离线资源：仅读取已加载的 DOM、CSSOM 和浏览器存储，不下载外部资源。');
        button('刷新', () => this.render());
        for (const storageName of ['localStorage', 'sessionStorage']) {
          text('h2', storageName);
          try {
            const storage = window[storageName];
            button('新增', () => {
              const key = window.prompt('键名');
              if (key === null) return;
              const value = window.prompt('值', '');
              if (value !== null) { storage.setItem(key, value); this.render(); }
            });
            for (const key of Object.keys(storage).filter((key) => !key.startsWith('eruda-'))) {
              const row = text('div', '');
              text('strong', key, row);
              text('pre', storage.getItem(key), row).style.whiteSpace = 'pre-wrap';
              button('编辑', () => {
                const value = window.prompt(key, storage.getItem(key));
                if (value !== null) { storage.setItem(key, value); this.render(); }
              }, row);
              button('删除', () => {
                if (window.confirm(`删除 ${storageName} 中的 ${key}？`)) { storage.removeItem(key); this.render(); }
              }, row);
            }
          } catch (error) { text('p', `当前页面无法读取：${error.message}`); }
        }
        text('h2', 'Cookie（浏览器允许读取的部分）');
        try { text('pre', document.cookie || '无可见 Cookie').style.whiteSpace = 'pre-wrap'; }
        catch (error) { text('p', error.message); }
        text('h2', 'Scripts');
        for (const script of document.scripts) {
          if (script.textContent.includes('eruda-offline:preferences:v1')) continue;
          if (script.src) text('p', `${script.src}（浏览器不提供已执行外部脚本的源码，不重新下载）`);
          else button(`查看内联脚本（${script.textContent.length} 字符）`, () => view('js', script.textContent));
        }
        text('h2', 'Stylesheets');
        for (const sheet of document.styleSheets) {
          if (sheet.ownerNode?.textContent?.includes('eruda-')) continue;
          button(sheet.href || '内联样式', () => {
            try { view('css', Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n')); }
            catch { view('raw', `浏览器不允许读取跨域样式：${sheet.href}\n离线模式不重新下载。`); }
          });
        }
        text('h2', 'Images');
        for (const img of document.images) text('p', `${img.currentSrc || img.src} · ${img.naturalWidth} × ${img.naturalHeight}`);
        text('h2', 'Iframes');
        for (const frame of document.querySelectorAll('iframe')) text('p', frame.src || '内联 iframe');
      },
    });
  }

  function initialize() {
    if (initialized) return;
    if (!eruda) eruda = loadEruda();
    else {
      for (const hook of networkHooks) {
        if (hook.target[hook.key] === hook.original) hook.target[hook.key] = hook.wrapped;
      }
    }
    container = document.createElement('div');
    document.documentElement.appendChild(container);
    try {
      eruda.init({ container, useShadowDom: true,
        tool: ['console', 'elements', 'network', 'sources', 'info', 'snippets'],
        defaults: { displaySize: 65, transparency: 1 } });
      container.id = 'eruda-offline-panel';
      const visibilityStyle = document.createElement('style');
      visibilityStyle.textContent = ':host([data-panel-open="true"]) .eruda-dev-tools { display: block !important; opacity: 1 !important; }';
      container.shadowRoot.appendChild(visibilityStyle);
      initialized = true;
      configureOfflineTools();
      // 使用公开 API；清除会从 CDN 加载插件的上游快捷命令。
      const snippets = eruda.get('snippets');
      snippets.clear();
      snippets.add('页面尺寸', () => {
        console.table({ viewport: { width: innerWidth, height: innerHeight },
          document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } });
        eruda.show('console');
      }, '查看布局尺寸，无需网络');
      snippets.add('性能时间', () => {
        console.table(performance.getEntriesByType('navigation').map((entry) => entry.toJSON()));
        eruda.show('console');
      }, '查看浏览器已记录的导航性能');
      snippets.add('切换元素轮廓', () => {
        if (outline) { outline.remove(); outline = null; return; }
        outline = document.createElement('style');
        outline.textContent = 'body * { outline: 1px dashed #64748b !important; }';
        document.head.appendChild(outline);
      }, '显示或还原页面元素轮廓');
      snippets.add('清除控制台', () => eruda.get('console').clear(), '清除当前捕获的日志');
      eruda.get('info').add('离线油猴脚本', options.version);
      // 避免上游 hide 的延迟动画在快速重开后再次隐藏面板。
      eruda.get().on('show', () => { visible = true; container.dataset.panelOpen = 'true'; applyEntry(); report(); });
      eruda.get().on('hide', () => { visible = false; container.dataset.panelOpen = 'false'; applyEntry(); report(); });
      eruda.hide();
      applyEntry();
    } catch (error) {
      try { eruda.destroy(); } catch { /* 初始化不完整时仍移除自己的容器。 */ }
      restoreNetwork();
      container.remove();
      initialized = false;
      throw error;
    }
  }

  function stop() {
    if (initialized) eruda.destroy();
    restoreNetwork();
    initialized = false;
    visible = false;
    outline?.remove();
    outline = null;
    container?.remove();
  }

  bridge.addEventListener(commandEvent, (event) => {
    try {
      // 跨 Firefox 隔离环境只传 JSON 字符串，不把 GM 权限暴露给页面。
      const command = JSON.parse(event.detail);
      errorMessage = '';
      switch (command.action) {
        case 'start': initialize(); break;
        case 'show': initialize(); eruda.show(); break;
        case 'hide': if (initialized) eruda.hide(); break;
        case 'entry': hiddenEntry = Boolean(command.hidden); applyEntry(); break;
        case 'stop': stop(); break;
        case 'status': break;
        default: return;
      }
    } catch (error) {
      errorMessage = String(error.message || error);
      console.error('[Eruda 离线调试]', error);
    }
    report();
  });
  report();
}
