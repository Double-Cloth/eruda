# Eruda 离线调试助手

用于手机浏览器的油猴脚本。Eruda 的完整浏览器发行源码、样式和图标均内嵌在单个 `.user.js` 文件中，不使用 `@require`、CDN、远程插件或运行时下载。

## 安装和使用

本地生成的安装文件是 **`dist/eruda-offline.user.js`**。在脚本管理器中新建脚本并导入该文件，或粘贴文件的完整内容保存。发布到 GitHub 后，打开 Release 附件中的同名文件安装即可。

默认行为：自动采集当前页面的日志和请求，调试面板关闭，原生悬浮球隐藏。通过浏览器扩展入口打开本脚本的油猴菜单：

| 菜单 | 行为 |
| --- | --- |
| 打开调试面板 | 显示 Eruda；尚未启动时自动初始化 |
| 关闭调试面板（保留采集） | 隐藏界面，继续记录日志和请求 |
| 显示 / 隐藏悬浮球 | 切换 Eruda 原生悬浮入口，立即生效并保存 |
| 切换自动采集 | 保存下次加载页面时是否自动启动；关闭后仍可手动打开 |
| 停止本页调试并释放资源 | 销毁面板、停止本实例采集、还原仍由本实例控制的网络方法；可以重新打开 |
| 查看状态与版本 | 查看运行状态、开关和内置 Eruda 版本 |

悬浮球和自动采集偏好使用 GM 存储，对本脚本全局生效，后续页面加载时读取。面板开关只影响当前页面。没有菜单 API 的管理器会自动显示悬浮球，避免丢失入口。

## 离线功能

- Console：页面日志、错误、对象检查和表达式执行。
- Elements：检查当前页面 DOM 和样式。
- Network：记录启用后页面发出的 Fetch / XHR 请求及浏览器允许读取的响应；断网时仍能查看已经记录的数据和失败请求。
- Sources：当前 DOM 快照、内联代码和已取得的响应内容，不重新下载页面。
- Resources：读取和编辑 localStorage / sessionStorage，查看可读 Cookie、内联脚本、可读 CSSOM、图片及 iframe 地址清单。
- Info、Settings：设备信息及 Eruda 自带设置。
- Snippets：页面尺寸、导航性能、切换元素轮廓、清除控制台，均无远程依赖。

为满足离线要求，替换了 Eruda 原生 Resources 面板和下载插件的快捷命令。Sources 中的远程图片 / iframe 预览改为显示地址。浏览器不提供已执行外部脚本的源码，也可能禁止读取跨域 CSS；这些资源仅列出地址，不尝试重新下载。页面本身、手动执行的网络代码以及脚本管理器的更新检查不属于调试工具的离线依赖。

## 油猴兼容

同时适配传统同步 `GM_*` 和现代异步 `GM.*` API；使用 Tampermonkey `@sandbox raw`、Violentmonkey `@inject-into page` 请求在页面环境运行。在隔离环境中优先用 `GM_addElement` 注入内嵌代码，其次尝试普通脚本节点，并检查注入是否成功。

这样捕获的是页面自身的日志和请求，不会覆盖页面已有的 `window.eruda`。菜单控制与页面代码通过只包含普通调试指令的 DOM 事件通信，GM 存储能力不暴露给页面桥接代码。

浏览器须支持扩展 / 用户脚本、Shadow DOM 和现代 JavaScript。脚本仅在顶层 HTTP、HTTPS、file 页面运行；file 页面需管理器允许访问本地文件。浏览器内部页、扩展商店和禁止注入的页面无法调试。严格 CSP 或管理器拒绝页面环境注入时会在菜单操作中给出错误，不会悄悄退回只能采集沙箱日志的模式。脚本启动前已发生的日志无法补录。页面自行更换 Fetch / XHR 包装、已有请求仍在进行或需要完全清除调试状态时，请刷新页面。

## 本地打包

需要 Node.js **22 或更新版本**。仓库已包含 `vendor/`，打包及单元测试不需要 `npm install`，也不需要网络：

```powershell
npm run build
npm test
```

输出文件：

```text
dist/
  eruda-offline.user.js   # 完整可安装脚本
  eruda-offline.meta.js   # 供脚本管理器检查更新
  build-info.json        # 版本和文件哈希
  SHA256SUMS.txt         # SHA-256 校验清单
  LICENSE.eruda.txt       # 上游许可证
```

更新内嵌 Eruda 后重新打包（仅更新步骤需要网络）：

```powershell
npm run update:eruda
npm run check
npm run test:browser
```

也可明确指定尚未内嵌的新稳定版：`npm run update:eruda -- --version 3.4.3`。更新器读取 npm 官方包元数据，校验下载归档的 SHA-512，只提取固定文件；从上游对应提交下载许可证，并保存源码和许可证的 SHA-256。拒绝预发布版本和自动降级。构建前会复核本地哈希。`vendor/eruda.js` 保留上游原始文件，打包时仅移除顶层 source map 下载引用。

`npm run test:browser` 使用本机 Chrome / Edge 的无头模式和 Node 内置 WebSocket，无 npm 测试依赖。找不到浏览器时设置 `CHROME_PATH`：

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:browser
```

浏览器验证使用 390 × 844 手机视口和触摸模拟，覆盖同步 GM、异步 GM、脚本注入回退、无菜单入口、日志 / 请求采集、断网切换全部面板、浮球开关、停止后重开。GM API 由测试夹具模拟；不等同于已在每一种手机浏览器和脚本管理器上实机测试。截图写入 `output/playwright/`。

## GitHub 自动更新与发布

仓库已初始化为 `main` 分支。创建自己的 GitHub 仓库后，将本地仓库推送过去：

```powershell
git remote add origin https://github.com/你的用户名/你的仓库.git
git push -u origin main
```

工作流 `.github/workflows/release.yml` 会在以下情况执行：推送到 `main`、每 6 小时检查一次、Actions 页面手动运行。执行顺序为：

1. 查询 npm 的 Eruda 最新稳定版，下载并校验变化。
2. 使用与本地相同的 `npm run check` 打包和测试，再执行浏览器断网验证。
3. 将经过验证的 `vendor/` 变化提交回 `main`。
4. 创建草稿 Release，上传完整脚本、元数据、清单及许可证；全部上传成功后发布为 Latest。
5. 没有版本变化时核对现有 Release，跳过重复发布；中途失败留下的草稿可在重跑时补齐。

启用仓库 Actions，并允许工作流使用 `contents: write`。不需要额外 PAT；使用 GitHub 自带 `GITHUB_TOKEN`。若组织策略或分支保护禁止机器人直接写 `main`，需要允许该工作流推送，否则更新提交步骤会失败。工作流中的构建、提交、发布在同一次运行中完成，不依赖机器人提交再次触发工作流。

GitHub 定时检查只在默认分支运行，因此将 `main` 设为默认分支。GitHub 可能延迟定时任务，公开仓库长期没有活动时可能停用定时工作流；可在 Actions 页面重新启用并手动运行。[GitHub 官方说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

首次发布后，安装地址为：

```text
https://github.com/OWNER/REPO/releases/latest/download/eruda-offline.user.js
```

Actions 自动读取 `GITHUB_REPOSITORY` 并写入正确的 `@updateURL` / `@downloadURL`。安装发布版后，油猴在其正常更新周期内检查并升级整个离线脚本。**未绑定仓库时本地产物不包含自动更新地址**；推送后重新安装 Release 版，或在本地明确指定仓库打包：

```powershell
npm run build -- --repository OWNER/REPO
```

本地也可以复用发布步骤。先配置正确的 origin、提交并推送代码，确保 `gh` 已登录，再运行：

```powershell
npm run check
npm run test:browser
npm run release
```

仓库识别优先级为：打包命令的 `--repository` 参数、`USERSCRIPT_REPOSITORY` 环境变量、`GITHUB_REPOSITORY`、GitHub origin。Release 步骤要求产物中的仓库与当前配置一致。脚本安装和自动更新面向公开可下载的 Release 附件；私有仓库附件需要认证，普通油猴更新请求不能直接使用。

### 版本约定

脚本版本为 `脚本版本.Eruda版本`，例如 `1.0.0.3.4.3`。两部分均使用三个数字段；Eruda 更新会提高后三段，脚本自身修改时提高前三段：

```powershell
npm version patch --no-git-tag-version
git add .
git commit -m "fix: update userscript"
git push
```

Release 标签为 `v1.0.0.3.4.3`。相同版本已有发布但产物不同，流程会拒绝覆盖，要求提高脚本版本。回退 Eruda 时恢复历史 `vendor/` 并提高脚本版本，确保油猴仍识别为新版本。

## 文件结构

| 路径 | 用途 |
| --- | --- |
| `src/userscript.js` | GM API 适配、菜单、偏好和页面环境注入 |
| `src/page.js` | Eruda 生命周期、离线工具和悬浮球控制 |
| `vendor/` | Eruda 原始发行源码、固定来源和许可证 |
| `scripts/build.mjs` | 零依赖、可复现的离线打包 |
| `scripts/update-eruda.mjs` | 下载和完整性校验 |
| `scripts/release.mjs` | 本地 / Actions 共用的草稿发布与重试流程 |
| `scripts/browser-check.mjs` | 零依赖的真实浏览器验证 |
| `.github/workflows/` | 自动更新发布与 PR 检查 |
| `tests/` | 打包、GM 控制器测试及浏览器夹具 |

参考：[Eruda API](https://eruda.liriliri.io/docs/api.html)、[Tampermonkey 文档](https://www.tampermonkey.net/documentation.php)、[Violentmonkey 页面注入说明](https://violentmonkey.github.io/api/metadata-block/#inject-into)。项目及内嵌 Eruda 均使用 MIT License。
