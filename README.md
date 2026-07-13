# MobileChat

MobileChat 是一个面向手机浏览器的本地优先聊天 PWA。它计划通过用户配置的 API 地址、API Key、模型和助手提示词直接发起对话，不依赖持续在线的个人电脑或专用应用服务器。

## 项目目标

- 可安装到手机主屏幕，一键打开对话。
- 支持多个 API 配置、模型和助手，并在同一对话中快捷切换。
- 对话、设置和历史记录保存在当前浏览器。
- 仅在单个对话内维护记忆，通过本地消息、压缩检查点和近期原文持续上下文，不建立跨对话用户记忆。
- 区分聊天助手与功能助手；上下文压缩等语义任务可引用专用功能助手。
- 可在调试模式下查看上下文预算、各来源 token 占比、provider usage 和可用的缓存命中统计。
- 支持完整的对话管理、会话内搜索、标题与摘要搜索、归档浏览与恢复。
- 使用可扩展的消息内容结构，为后续多模态能力预留空间。
- 提供版本化 `.mobilechat` 压缩备份包的本地导入、导出能力，用于手动跨设备迁移。

## 当前状态

项目使用 OpenSpec 进行规格驱动开发。当前已进入实现阶段，首个完成项是 React + TypeScript + Vite 的移动端 PWA 外壳。

当前会话状态、上下文压缩、中转站探测和跨设备迁移决策见[会话状态、上下文压缩与数据迁移](docs/architecture/conversation-state-and-portability.md)。

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

该脚本会启动 Vite 开发服务器，并用独立 Chrome/Edge app 窗口打开 `http://127.0.0.1:5173/MobileChat/`。停止脚本管理的窗口和开发服务器：

```powershell
.\run.ps1 -Stop
```

## 当前实现

- 已实现本地 `MobileChatDB` 持久化、credential-free `.mobilechat` 导入/导出、亮色/暗色/跟随系统主题切换。
- 默认布局按视口自动适配手机网页；设置页可启用“电脑端布局”，仅强制桌面显示结构，不改变对话、存储或请求逻辑。
- 设置页支持独立编辑 API Profile 与模型列表；模型配置区会展示当前 Profile 的完整模型清单。助手只引用已有模型，并配置允许模型列表与默认模型。
- API Profile、模型、助手、普通对话和归档对话都提供本地 CRUD 操作；删除最后一个运行必需对象时会创建空占位，避免页面进入不可用状态。
- 聊天页支持切换当前助手和该助手允许使用的模型。
- 仓库不内置具体中转站、API key 或模型 slug；首次使用时通过设置页或本机数据库配置连接与模型。
- 已接入 OpenAI-compatible Responses 与 Chat Completions 两种协议：Responses 走 `POST {baseUrl}/responses`、`store:false`；Chat Completions 走 `POST {baseUrl}/chat/completions`。两者都由本地消息构建单对话上下文。
- 模型级联网工具会按协议序列化：Responses 使用 `web_search` tool，Chat Completions 使用 `web_search_options`。
- 设置页可切换流式输出；开启后使用 Responses SSE 的 `response.output_text.delta` 增量更新消息。若中转站对 `stream:true` 仍返回普通 JSON，前端会回退为一次性解析。
- 对话标题可在聊天头部直接编辑，历史搜索仍只匹配标题和摘要；归档对话有独立入口，可搜索、浏览和恢复，恢复前默认只读。
- 消息支持删除；助手回复支持重试。重试会保留该回复之前的上下文，移除该回复及其后的后续消息，再用当前助手/模型重新生成。
- 调试面板的发送后 usage 只显示 cache 命中，例如 `cache 0/471`。完整 provider usage 仍保存在消息记录中，后续成本面板可继续使用。
- 联网搜索已接入模型级开关；开启后该模型请求会携带 Responses `web_search` 工具配置。多模态输入仍待接入，应继续按模型/adapter 能力显式发送，而不是只靠提示词要求模型处理。
- 静态页直连 API 依赖中转站允许浏览器 CORS；若中转站未开放 CORS，聊天窗口会显示网络/CORS 错误，届时需要另加极薄代理服务。

## 数据与部署

- 应用以静态 PWA 形式部署。
- 结构化数据保存在 IndexedDB。
- 不要求账号、云端数据库或常驻后端。
- API 服务必须允许手机浏览器直接访问。
- 跨设备访问通过导出、传输和导入备份包完成，不把浏览器内部 IndexedDB 文件当作可移植格式。

## License

尚未选择许可证。
