# MobileChat

MobileChat 是一个面向手机浏览器的本地优先聊天 PWA。它计划通过用户配置的 API 地址、API Key、模型和助手提示词直接发起对话，不依赖持续在线的个人电脑或专用应用服务器。

## 项目目标

- 可安装到手机主屏幕，一键打开对话。
- 支持多个 API 配置、模型和助手，并在同一对话中快捷切换。
- 对话、设置和历史记录保存在当前浏览器。
- 仅在单个对话内维护记忆，通过本地消息、上下文总结和近期原文持续上下文，不建立跨对话用户记忆。
- 区分聊天助手与功能助手；聊天助手引用可复用上下文 Profile，首版仅通过滚动上下文总结维护长对话上下文，不再提供单独的精简类助手入口。
- 可在调试模式下查看上下文预算、各来源 token 占比、provider usage 和可用的缓存命中统计。
- 支持完整的对话管理、会话内搜索、标题与摘要搜索、归档浏览与恢复。
- 使用可扩展的消息内容结构，为后续多模态能力预留空间。
- 提供版本化 `.mobilechat` 压缩备份包的本地导入、导出能力，用于手动跨设备迁移。

## 当前状态

项目使用 OpenSpec 进行规格驱动开发。当前已进入实现阶段，首个完成项是 React + TypeScript + Vite 的移动端 PWA 外壳。

当前会话状态、上下文总结、中转站探测和跨设备迁移决策见[会话状态、上下文总结与数据迁移](docs/architecture/conversation-state-and-portability.md)。

当前 UI 实测状态和手机端助手配置反馈见[Mobile UI state](docs/status/mobile-ui-state.md)。

## 本地开发

```bash
npm install
npm run dev
```

常用验证命令：

```bash
npm run format:check
npm run lint
npm run test
npm run test:browser
npm run build
```

PC 独立窗口开发：

```powershell
.\run.ps1
```

或双击/运行：

```cmd
run.bat
```

该脚本会检查并安装缺失的 Node 依赖，启动 Vite 开发服务器，并用独立 Chrome/Edge app 窗口打开 `http://127.0.0.1:5173/MobileChat/`。这个桌面窗口不是离线打包程序；如果只点击浏览器历史窗口或固定的 app 快捷方式，而没有先运行 `run.ps1` / `run.bat`，会因为本地服务未启动而显示 `127.0.0.1 拒绝连接`。停止脚本管理的窗口和开发服务器：

```powershell
.\run.ps1 -Stop
```

## 当前实现

- 已实现本地 `MobileChatDB` 持久化、credential-free `.mobilechat` 导入/导出、亮色/暗色/跟随系统主题切换。
- 默认布局按视口自动适配手机网页；设置页可在“跟随屏幕 / 手机端 / 电脑端”之间切换布局模式，仅改变显示结构，不改变对话、存储或请求逻辑。
- 设置页支持独立编辑 API Profile、模型列表和上下文 Profile；默认连接和新增连接不再内置默认模型，模型应由探测成功项或用户显式新增创建。助手只引用已有模型，并配置允许模型列表、默认模型和上下文 Profile。
- 上下文 Profile 的五个维度可逐项启用/停用；停用维度不进入聊天和总结请求，但已填写内容会保留以便后续重新启用。
- API Profile、模型、助手、上下文 Profile、普通对话和归档对话都提供本地 CRUD 操作；删除最后一个运行必需对象时会创建空占位，避免页面进入不可用状态。
- 聊天页支持切换当前助手和该助手允许使用的模型。
- 仓库不内置具体中转站、API key 或模型 slug；首次使用时通过设置页或本机数据库配置连接与模型。
- 已接入 OpenAI-compatible Responses 与 Chat Completions 两种协议：Responses 走 `POST {baseUrl}/responses`、`store:false`；Chat Completions 走 `POST {baseUrl}/chat/completions`。两者都由本地消息构建单对话上下文。
- 输入框区域提供“联网”本轮临时选项：Responses 使用 `web_search` tool，Chat Completions 使用 `web_search_options`；发送后自动恢复非联网默认状态。
- 设置页可切换流式输出；开启后使用 Responses SSE 的 `response.output_text.delta` 增量更新消息。若中转站对 `stream:true` 仍返回普通 JSON，前端会回退为一次性解析。
- 对话标题可在聊天头部直接编辑，历史搜索仍只匹配标题和摘要；归档对话有独立入口，可搜索、浏览和恢复，恢复前默认只读。
- 消息支持删除；助手回复支持重试。重试会保留该回复之前的上下文，移除该回复及其后的后续消息，再用当前助手/模型重新生成。
- 调试面板的发送后 usage 只显示 cache 命中，例如 `cache 0/471`；若 relay 只返回输入 token 而不返回 cached token，则显示 `cache 未返回/N`。完整 provider usage 仍保存在消息记录中，后续成本面板可继续使用。
- 联网搜索已接入本轮发送开关；开启后仅当前请求携带联网工具配置。多模态入口先作为本轮临时选项预留，图片/文件内容选择与发送仍待接入。
- 静态页直连 API 依赖中转站允许浏览器 CORS；若中转站未开放 CORS，聊天窗口会显示网络/CORS 错误，届时需要另加极薄代理服务。

## 数据与部署

- 应用以静态 PWA 形式部署。
- 结构化数据保存在 IndexedDB。
- 不要求账号、云端数据库或常驻后端。
- API 服务必须允许手机浏览器直接访问。
- 跨设备访问通过导出、传输和导入备份包完成，不把浏览器内部 IndexedDB 文件当作可移植格式。
- 手机端反复迭代测试应尽量保持同一访问 origin，例如 GitHub Pages 的 `/MobileChat/` 路径；同一浏览器同一 origin 下更新静态代码不会清空已有 IndexedDB。
- 手机测试打包与 ADB 辅助脚本见[手机测试部署](docs/deployment/mobile-testing.md)，移动端默认入口为固定包名的 Android WebView APK，统一脚本为 `scripts/deploy-android.ps1`。

常用手机测试命令：

```powershell
npm run mobile:adb
```

`mobile:adb` 是常规单入口：已有匹配当前代码/构建产物的最新 `mobilechat-webview-YYYYMMDD.apk` 时会直接复用，否则自动构建并重新打包。脚本默认安装并打开显示名为“对话助手”的 `com.uc83824985.mobilechat` WebView 壳，页面固定加载 `https://appassets.androidplatform.net/app/index.html`，使 WebView IndexedDB origin 在后续覆盖升级中保持不变。设置页的“沉浸显示（Android）”只在该 Android 壳内通过本地 bridge 生效，会隐藏系统栏并允许内容扩展到刘海/挖孔短边区域，不影响桌面端或普通浏览器。旧本地文件模式仅保留为 `npm run mobile:file`，用于 smoke test，不再作为稳定数据入口。

## License

尚未选择许可证。
