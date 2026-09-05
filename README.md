# Eruda 离线调试助手

面向手机浏览器的油猴脚本，将 Eruda 源码、样式、图标和 DOM 编辑器内嵌到单个 `.user.js` 文件。调试工具运行时无需 CDN、远程插件或额外下载，已加载的页面可以断网调试。

## 安装与使用

打开 [最新脚本](https://github.com/Double-Cloth/eruda/releases/latest/download/eruda-offline.user.js)，由脚本管理器完成安装。也可以从 [Releases](https://github.com/Double-Cloth/eruda/releases) 下载附件，或导入本地构建的 `dist/eruda-offline.user.js`。

默认自动采集页面日志和请求，调试面板关闭，悬浮球隐藏。通过脚本管理器菜单打开面板。菜单文字表示**点击后执行的动作**，随当前状态更新：

| 控制项 | 当前状态 → 菜单文字 | 生效范围 |
| --- | --- | --- |
| 调试面板 | 关闭 → `打开调试面板`；打开 → `关闭调试面板` | 当前页面，关闭面板仍继续采集 |
| 悬浮球 | 未显示 → `显示悬浮球`；已显示 → `隐藏悬浮球` | 立即生效，显示偏好保存到后续页面 |
| 自动采集 | 已开启 → `关闭自动采集（下次加载生效）`；已关闭 → `开启自动采集（下次加载生效）` | 保存后在下次加载页面时生效 |
| 停止调试 | `停止本页调试并释放资源` | 销毁面板、停止采集并恢复仍由本实例控制的网络方法 |
| 运行信息 | `查看状态与版本` | 查看采集、面板、偏好及版本信息 |

通过原生悬浮球打开或关闭面板时，菜单也会更新。停止调试后，可以通过打开面板或显示悬浮球重新启动。关闭自动采集不影响手动启动。

悬浮球和自动采集偏好使用 GM 存储，对本脚本全局生效；存储不可用时会提示设置仅在本页有效。没有可用菜单时自动显示悬浮球，保留操作入口。缺少菜单注销 API 的管理器保留首次注册的菜单，无法动态更新文字。

## 调试功能

| 工具 | 功能 |
| --- | --- |
| Console | 页面日志、错误、对象检查和表达式执行 |
| Elements | 检查 DOM 和样式，插入 DOM，编辑节点 HTML、属性、文本及注释 |
| Network | 记录启动后发出的 Fetch / XHR 请求及浏览器允许读取的响应 |
| Sources | 查看当前 DOM 快照、内联代码和已取得的响应内容 |
| Resources | 读写 localStorage / sessionStorage，查看可读 Cookie、内联脚本、可读 CSSOM、图片及 iframe 地址 |
| Info、Settings | 设备信息和 Eruda 设置 |
| Snippets | 页面尺寸、导航性能、元素轮廓及清除控制台 |

### DOM 编辑

在 Elements 中，点击箭头展开节点。标签、节点行空白、属性、文本或注释第一次点击仅选中，再次点击同一行的同一编辑位置才打开编辑器，无需快速双击。标签或节点行空白编辑 HTML，属性编辑名称和值，文本或注释编辑文字；切换节点、属性、展开箭头或工具面板后，需要重新点击两次。工具栏“编辑”按钮仍可单击编辑当前选中的节点，包括通过页面取点选中的节点。

编辑器支持 HTML、文本、属性模式，提供离线语法高亮及明暗主题。点击“应用修改”写回页面，“取消”或 Escape 放弃修改。

工具栏“插入”按钮可在当前选中节点的之前、内部开头、内部末尾或之后插入 DOM；不支持子节点的位置会自动禁用。一次可插入多个元素、文本或注释，并按目标上下文保留表格、SVG、MathML、template 与 Shadow DOM 语义。插入位置已被页面更新时会提示重新选择。

- 属性支持修改、新增、改名、删除；空值与删除分开处理，保留 SVG 属性大小写及命名空间，重名时提示冲突。
- HTML 模式支持普通元素、表单、表格、SVG、MathML、template 和自定义元素；普通节点接受一个完整节点，ShadowRoot 接受内部 HTML 片段。html、head、body 仅允许编辑属性。
- 修改时尽量复用原节点和可匹配的子节点，保留事件监听、节点引用以及未编辑的表单实时值。更换标签、删除节点或跨层级重组无法保证事件保留。
- 节点或内容已被页面更新时，会提示重新选择，避免覆盖过期内容。修改只影响当前页面，刷新或页面框架重新渲染可能覆盖修改。

### 离线边界与兼容性

Resources 使用页面现有数据；Sources 不重新下载页面或预览远程图片、iframe；在线插件命令已移除，日志中的 HTML 和样式会处理为不会自动加载外部资源的内容。

离线模式不能取得尚未下载的页面、外部源码或新的服务器响应。跨域 CSS、Cookie 和响应内容仍受浏览器权限限制。手动执行网络代码或应用含远程资源地址的 DOM 修改，会按页面正常行为发起请求。脚本管理器的更新检查也需要网络，可在管理器中关闭自动更新。

脚本适配同步 `GM_*` 与异步 `GM.*` API，请求在页面环境运行，以采集页面自身的日志和请求；不会覆盖页面已有的 `window.eruda`。仅在顶层 HTTP、HTTPS、file 页面运行，file 页面需要管理器允许访问本地文件。浏览器需支持用户脚本、Shadow DOM 和现代 JavaScript。

浏览器内部页、禁止注入的页面以及阻止页面环境注入的 CSP 无法正常调试。脚本启动前的日志不能补录；页面自行替换网络包装或需要完全清除调试状态时，请刷新页面。

图标字体直接从脚本内嵌的二进制数据注册，不通过 `data:` 字体地址加载，兼容 GitHub 等限制 `font-src` 的页面；停止调试时释放本实例注册的字体。

## 项目结构与实现

```text
src/
  userscript.js                GM API、动态菜单、偏好存储与页面注入
  page.js                      Eruda 生命周期、离线工具与悬浮球
  elements-editor.js           DOM 插入与编辑器、输入校验及节点差异更新
vendor/
  eruda.js                     上游原始发行文件
  eruda.json                   固定版本、下载来源与完整性记录
  LICENSE.eruda                上游许可证
scripts/
  build.mjs                    内嵌源码、生成元数据与校验清单
  update-eruda.mjs              下载并校验上游稳定版
  release.mjs                  Release 附件校验、草稿上传与发布
  lib.mjs                      路径、版本、仓库识别与哈希工具
  browser-check.mjs            浏览器启动与端到端验证
  browser-elements-check.mjs   DOM 编辑浏览器回归
tests/
  controller.test.mjs          GM 控制器与菜单状态测试
  build.test.mjs               构建、版本与完整性测试
  browser-launch.test.mjs      浏览器启动失败测试
  fixtures/                   页面与 GM API 模拟夹具
.github/workflows/
  ci.yml                    PR 和非 main 分支检查
  release.yml                  main 构建、上游更新与发布
```

控制器在用户脚本环境中管理 GM 权限，通过 DOM 事件向页面发送调试指令；页面回报运行状态，用于更新菜单。菜单注册和注销串行执行，兼容异步 API，避免并发更新产生重复菜单。GM 存储能力不暴露给页面桥接代码。

构建将 `elements-editor.js` 和 `vendor/eruda.js` 内嵌到 `page.js`，再内嵌到 `userscript.js`，生成完整安装文件。上游文件保留原样，构建时校验哈希、移除顶层 source map 下载引用，并将字体 URL 声明转换为独立命名的内嵌字体数据。项目不引入运行时远程依赖，打包和测试使用 Node.js 内置能力。

## 本地开发与验证

需要 Node.js **22 或更新版本**。仓库包含 `vendor/`，无需 `npm install`：

```powershell
npm run check
npm run test:browser
```

`check` 执行构建和单元测试。浏览器验证使用本机 Chrome / Edge，覆盖桌面鼠标、手机触摸、同步与异步 GM、注入回退、无菜单入口、断网调试、DOM 编辑、动态菜单、悬浮球及停止后重开。GM API 由夹具模拟，不代表所有手机浏览器和脚本管理器均已实机验证。

字体回归额外使用带 `font-src 'none'` 响应头的本地 HTTP 页面，检查悬浮球和清空按钮确实使用内嵌字体绘制、清空日志功能及字体释放和重新注册。

Console 回归通过桌面鼠标和手机触摸反复切换 All、Info、Warning、Error，检查日志筛选、唯一高亮及实际高亮颜色，并验证停止调试后重开仍然正常。

浏览器路径依次读取 `CHROME_PATH`、`CHROME_BIN`，然后查找本机安装；需要时手动指定：

```powershell
$env:CHROME_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:browser
```

截图写入 `output/playwright/`。构建产物写入 `dist/`，两者均不提交到 Git：

| 文件 | 用途 |
| --- | --- |
| `eruda-offline.user.js` | 完整可安装脚本 |
| `eruda-offline.meta.js` | 脚本管理器更新元数据 |
| `build-info.json` | 脚本版本、Eruda 版本、仓库与文件哈希 |
| `SHA256SUMS.txt` | SHA-256 校验清单 |
| `LICENSE.eruda.txt` | 上游许可证 |

### 更新内嵌 Eruda

```powershell
npm run update:eruda
npm run check
npm run test:browser
```

仅更新步骤需要网络。更新器查询 npm 稳定版，校验归档 SHA-512、提取固定文件并获取对应提交的许可证，保存源码和许可证 SHA-256；拒绝预发布版本和自动降级。需要固定目标版本时使用 `npm run update:eruda -- --version x.y.z`。

## 版本与发布

脚本版本由 `package.json` 版本和内嵌 Eruda 版本组成，格式为 `脚本版本.Eruda版本`，Release 标签为 `v` 加完整版本。修改脚本时提升 `package.json` 版本，避免相同版本对应不同产物：

```powershell
npm version patch --no-git-tag-version
npm run check
npm run test:browser
```

### GitHub Actions

`release.yml` 在推送到 `main`、每 6 小时定时检查或手动运行时执行：

1. 检查并校验上游 Eruda 稳定版。
2. 构建、单元测试和浏览器验证。
3. 将通过验证的 `vendor/` 变化提交到 `main`。
4. 创建或补齐草稿 Release，全部附件上传成功后发布为 Latest。

已发布版本的清单与本次产物一致时跳过发布；同版本产物不一致时拒绝覆盖，需要提升脚本版本。仓库需启用 Actions，并允许工作流的 `GITHUB_TOKEN` 写入内容和推送 `main`；定时运行需将 `main` 设为默认分支。

`ci.yml` 对 PR 和非 `main` 分支推送执行相同的构建、单元测试与浏览器验证。

### 本地发布与更新地址

已配置 GitHub origin、提交并推送代码且 `gh` 已登录时，可以在验证后执行：

```powershell
npm run release
```

构建时按以下优先级识别仓库：`--repository owner/repo`、`USERSCRIPT_REPOSITORY`、`GITHUB_REPOSITORY`、GitHub origin。例如：

```powershell
npm run build -- --repository Double-Cloth/eruda
```

识别到仓库时，产物自动包含对应 Release 附件的 `@updateURL` 和 `@downloadURL`；没有仓库配置时仍可离线构建，但不包含更新地址。发布命令要求产物记录的仓库与当前配置一致。已安装的发布版由脚本管理器按其更新周期升级，附件需可公开下载。

## 许可证

项目与内嵌 Eruda 均使用 MIT License，分别见 [LICENSE](LICENSE) 和 [vendor/LICENSE.eruda](vendor/LICENSE.eruda)。
