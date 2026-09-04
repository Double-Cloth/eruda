# Eruda 离线调试助手

用于手机浏览器的油猴脚本。Eruda 的完整浏览器发行源码、样式和图标均内嵌在单个 `.user.js` 文件中，不使用 `@require`、CDN、远程插件或运行时下载。

## 安装和使用

本地生成的安装文件是 **`dist/eruda-offline.user.js`**。在脚本管理器中新建脚本并导入该文件，或粘贴文件的完整内容保存。发布到 GitHub 后，打开 Release 附件中的同名文件安装即可。

默认行为：自动采集当前页面的日志和请求，调试面板关闭，原生悬浮球隐藏。通过浏览器扩展入口打开本脚本的油猴菜单：

| 菜单 | 行为 |
| --- | --- |
| 打开 / 关闭调试面板 | 一个按钮按实际状态切换；尚未启动时自动初始化，关闭界面后继续采集 |
| 显示 / 隐藏悬浮球 | 切换 Eruda 原生悬浮入口，立即生效并保存 |
| 切换自动采集 | 保存下次加载页面时是否自动启动；关闭后仍可手动打开 |
| 停止本页调试并释放资源 | 销毁面板、停止本实例采集、还原仍由本实例控制的网络方法；可以重新打开 |
| 查看状态与版本 | 查看运行状态、开关和内置 Eruda 版本 |

悬浮球和自动采集偏好使用 GM 存储，对本脚本全局生效，后续页面加载时读取。面板开关只影响当前页面。没有菜单 API 的管理器会自动显示悬浮球，避免丢失入口。

悬浮球每次显示时恢复原生 flex 居中布局，避免隐藏后重新显示导致工具图标向左上偏移。

## 离线功能

- Console：页面日志、错误、对象检查和表达式执行。
- Elements：检查当前页面 DOM 和样式，点击标签、属性或文本即可编辑。
- Network：记录启用后页面发出的 Fetch / XHR 请求及浏览器允许读取的响应；断网时仍能查看已经记录的数据和失败请求。
- Sources：当前 DOM 快照、内联代码和已取得的响应内容，不重新下载页面。
- Resources：读取和编辑 localStorage / sessionStorage，查看可读 Cookie、内联脚本、可读 CSSOM、图片及 iframe 地址清单。
- Info、Settings：设备信息及 Eruda 自带设置。
- Snippets：页面尺寸、导航性能、切换元素轮廓、清除控制台，均无远程依赖。

为满足离线要求，替换了 Eruda 原生 Resources 面板和下载插件的快捷命令。Sources 中的远程图片 / iframe 预览改为显示地址。浏览器不提供已执行外部脚本的源码，也可能禁止读取跨域 CSS；这些资源仅列出地址，不尝试重新下载。页面本身、手动执行的网络代码以及脚本管理器的更新检查不属于调试工具的离线依赖。

日志渲染也做了离线处理：`%c` 仅保留颜色、字号、间距等不会下载资源的样式；`%s` 等字符串占位符进行 HTML 转义，HTML 日志作为文本显示，避免背景图片、远程字体、图片 / iframe 标签引起额外加载。Info 中的赞助和在线帮助入口已移除。Eruda 图标和字体均为脚本内嵌的 `data:` 数据。

**已加载的页面可以断网调试，调试脚本自身无需下载外部资源。** 离线不能获取尚未下载的页面、外部源码或新的服务器响应。GitHub 更新 Eruda、油猴检查脚本新版本仍需要联网；如需连更新检查也不联网，请在脚本管理器中关闭该脚本的自动更新。

### 在 Elements 中编辑 DOM

在 DOM 树中点击左侧箭头展开节点，点击具体内容开始编辑：

| 点击位置 | 编辑内容 |
| --- | --- |
| 元素标签、结束标签或节点行空白 | 完整节点 HTML，可修改标签、属性和子节点；支持普通元素、表单、表格、SVG、MathML、template 及自定义元素 |
| 属性名或属性值 | 展示现有属性名和值，可选择修改 / 新增 / 改名 / 删除属性；空值与删除分开处理 |
| 文本或注释 | 修改当前文字，保留同级节点 |
| ShadowRoot 行 | 编辑其内部 HTML，支持多个子节点；保留 ShadowRoot 本身 |
| 工具栏“编辑” | 编辑当前选中的节点，也支持通过页面取点选中的节点 |

编辑器内可以切换 HTML、文本和属性模式。属性模式默认选中第一个已有属性，并列出完整属性名和值；点击“新增属性”打开空表单。SVG 的 `viewBox` 等属性保留大小写，`xlink:*`、`xml:*`、`xmlns` 属性保留对应命名空间。改名或新增与现有属性重名时会提示，避免覆盖。`checked`、`disabled` 等布尔属性以是否存在为准，空值依然表示存在，要关闭请删除属性。

点击“应用修改”立即写回页面；“取消”或 Escape 放弃本次修改。小屏幕中编辑字段可滚动，取消和应用按钮保持可见。HTML 模式接受一个完整的元素、文本或注释节点，ShadowRoot 接受内部 HTML 片段；html、head、body 结构根节点仍仅允许编辑属性，请选择其子节点修改内容。节点被页面移除、属性被更新或后代被替换（即使 HTML 完全相同）时，会提示重新选择，避免覆盖过期内容。

点击编辑直接关联当前 DOM 树行对应的真实节点，不依赖触摸或鼠标的选中事件顺序。页面动态移除或替换选中的节点时，选择会回到仍存在的祖先，重新点击即可编辑新节点。

编辑区提供离线实时语法高亮：HTML 标签、属性名、属性值、注释和实体分别着色，支持明暗主题。文本模式保留纯文本显示，属性模式突出属性值；script/style 内的代码目前按原始文本显示。输入使用原生文本框，支持中文输入、选择和复制粘贴，高亮随横向 / 纵向滚动同步，不预览或执行输入的 HTML。超过 20 万字符时暂用纯文本显示以减少输入开销，完整内容仍可编辑。

属性修改保留原节点和事件监听。HTML 修改按差异更新：标签和命名空间一致时复用原节点，只修改发生变化的属性和内容；同级子节点优先按唯一 `id` 匹配，其余按相同内容或兼容类型复用，尽量保留 `addEventListener`、`onclick` 和页面持有的节点引用。更换容器标签时，仍尝试复用可匹配的子节点。template 的内容通过 `content` 更新；编辑 Shadow DOM 宿主的普通 HTML 不改变其影子树。

更换标签或节点类型会失去该节点自身的事件绑定；删除的节点、无法匹配的节点及跨层级重组无法保证事件保留。移动节点仍可能触发自定义元素生命周期或浏览器状态重置。表单未编辑的实时值保持不变，明确修改 `value`、`checked`、`selected` 或 textarea 文本时同步对应状态。元素及 ShadowRoot 的文本模式会把内部内容改为纯文本；未修改内容直接应用时不重建子节点。修改只作用于当前页面，刷新后恢复，页面框架的重新渲染也可能覆盖修改。

编辑器不进行 HTML / 资源预览，输入和验证过程无需联网。手动应用带有远程 `src`、`href` 或 CSS 资源引用的修改后，页面仍会按浏览器正常行为尝试加载这些资源。

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

浏览器路径优先读取 `CHROME_PATH`，其次读取 Actions 镜像提供的 `CHROME_BIN`，最后查找本机安装。启动最多等待 30 秒；进程启动失败或提前退出时立即报告路径、退出码和 Chrome 错误输出，不再只显示端口超时。日志也会记录调试连接的启动耗时。刷新验证等待新文档完成加载，避免在较慢的 CI 环境中误读旧页面状态。

浏览器验证使用 390 × 844 手机视口及触摸模拟、1280 × 844 桌面视口及鼠标输入，覆盖同步 GM、异步 GM、脚本注入回退、无菜单入口、日志 / 请求采集、日志样式和 HTML 占位符的外部资源检查、断网切换全部面板、DOM 属性 / 文本 / HTML 编辑及过期内容检查、空 div / 嵌套 div / 无属性节点 / 结束标签 / Shadow DOM 点击、动态替换选中节点、单菜单开关、浮球开关、停止后重开。DOM 回归还检查属性列表、重名冲突、SVG 命名空间、表格 / MathML / template / 表单状态、ShadowRoot 多节点编辑、节点类型转换、HTML 更新和同级重排后的对象身份与事件触发。GM API 由测试夹具模拟；不等同于已在每一种手机浏览器和脚本管理器上实机测试。截图写入 `output/playwright/`。

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
| `src/elements-editor.js` | Elements 点击编辑、输入校验及 DOM 修改 |
| `vendor/` | Eruda 原始发行源码、固定来源和许可证 |
| `scripts/build.mjs` | 零依赖、可复现的离线打包 |
| `scripts/update-eruda.mjs` | 下载和完整性校验 |
| `scripts/release.mjs` | 本地 / Actions 共用的草稿发布与重试流程 |
| `scripts/browser-check.mjs` | 零依赖的真实浏览器验证 |
| `scripts/browser-elements-check.mjs` | DOM 属性、节点类型和事件保留的浏览器回归 |
| `.github/workflows/` | 自动更新发布与 PR 检查 |
| `tests/` | 打包、GM 控制器测试及浏览器夹具 |

参考：[Eruda API](https://eruda.liriliri.io/docs/api.html)、[Tampermonkey 文档](https://www.tampermonkey.net/documentation.php)、[Violentmonkey 页面注入说明](https://violentmonkey.github.io/api/metadata-block/#inject-into)。项目及内嵌 Eruda 均使用 MIT License。
