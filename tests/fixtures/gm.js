// 浏览器验证夹具：模拟脚本管理器，菜单回调仍由实际产物注册。
window.unsafeWindow = window;
window.fixtureMenus = new Map();
window.GM_getValue = (key, fallback) => JSON.parse(localStorage.getItem(`fixture:${key}`) || 'null') ?? fallback;
window.GM_setValue = (key, value) => localStorage.setItem(`fixture:${key}`, JSON.stringify(value));
window.GM_registerMenuCommand = (label, callback) => {
  window.fixtureMenus.set(label, callback);
  return window.fixtureMenus.size;
};
window.addEventListener('DOMContentLoaded', () => {
  for (const [label, action] of window.fixtureMenus) {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', action);
    document.querySelector('#menus')?.append(button, document.createElement('br'));
  }
});
