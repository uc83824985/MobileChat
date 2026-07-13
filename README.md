# MobileChat

MobileChat 是一个面向手机浏览器的本地优先聊天 PWA。它计划通过用户配置的 API 地址、API Key、模型和助手提示词直接发起对话，不依赖持续在线的个人电脑或专用应用服务器。

## 项目目标

- 可安装到手机主屏幕，一键打开对话。
- 支持多个 API 配置、模型和助手，并在同一对话中快捷切换。
- 对话、设置和历史记录保存在当前浏览器。
- 仅在单个对话内维护记忆，通过本地消息、压缩检查点和近期原文持续上下文，不建立跨对话用户记忆。
- 区分聊天助手与功能助手；上下文压缩等语义任务可引用专用功能助手。
- 可在调试模式下查看上下文预算、各来源 token 占比、provider usage 和可用的缓存命中统计。
- 支持完整的对话管理、会话内搜索、标题与摘要搜索。
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
- 设置页支持独立编辑 API Profile 与模型列表；助手只引用已有模型，并配置允许模型列表与默认模型。
- 聊天页支持切换当前助手和该助手允许使用的模型。
- 已内置不含密钥的 MNAPI 预设：`https://api.mnapi.com/v1`、`openai-responses`、`gpt-5.4-codex-high` 等模型 slug。真实 API key 只在本地设置页录入并持久化，不写入仓库。
- 已接入最小 OpenAI-compatible Responses API 请求循环：`POST {baseUrl}/responses`、`store:false`、由本地消息构建上下文。
- 设置页可切换流式输出；开启后使用 Responses SSE 的 `response.output_text.delta` 增量更新消息，关闭后使用一次性 JSON 响应。
- 对话标题可在聊天头部直接编辑，历史搜索仍只匹配标题和摘要。
- 调试面板的发送后 usage 显示为 `in / out / total · cache cached/input`；其中 cache 部分是缓存输入命中，不是总用量。
- 静态页直连 API 依赖中转站允许浏览器 CORS；若中转站未开放 CORS，聊天窗口会显示网络/CORS 错误，届时需要另加极薄代理服务。

## 数据与部署

- 应用以静态 PWA 形式部署。
- 结构化数据保存在 IndexedDB。
- 不要求账号、云端数据库或常驻后端。
- API 服务必须允许手机浏览器直接访问。
- 跨设备访问通过导出、传输和导入备份包完成，不把浏览器内部 IndexedDB 文件当作可移植格式。

## License

尚未选择许可证。
