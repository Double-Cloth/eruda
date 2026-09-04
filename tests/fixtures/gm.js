// 浏览器验证夹具：模拟脚本管理器，菜单回调仍由实际产物注册。
window.unsafeWindow = window;
window.fixtureMenus = new Map();
window.fixtureAlerts = [];
window.alert = (message) => window.fixtureAlerts.push(message);
const fixtureMenuIds = new Map();
let fixtureNextMenuId = 0;
function renderFixtureMenus() {
  const container = document.querySelector('#menus');
  if (!container) return;
  container.replaceChildren();
  for (const [label, action] of window.fixtureMenus) {
    const button = document.createElement('button');
    button.textContent = label;
    button.addEventListener('click', action);
    container.append(button, document.createElement('br'));
  }
}
window.GM_getValue = (key, fallback) => JSON.parse(localStorage.getItem(`fixture:${key}`) || 'null') ?? fallback;
window.GM_setValue = (key, value) => localStorage.setItem(`fixture:${key}`, JSON.stringify(value));
window.GM_registerMenuCommand = (label, callback) => {
  const id = fixtureNextMenuId++;
  fixtureMenuIds.set(id, label);
  window.fixtureMenus.set(label, callback);
  renderFixtureMenus();
  return id;
};
window.GM_unregisterMenuCommand = (id) => {
  window.fixtureMenus.delete(fixtureMenuIds.get(id));
  fixtureMenuIds.delete(id);
  renderFixtureMenus();
};
window.addEventListener('DOMContentLoaded', renderFixtureMenus);
