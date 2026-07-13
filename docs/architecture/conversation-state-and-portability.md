# 会话状态、上下文压缩与数据迁移

本文记录 MobileChat 首版关于会话状态、单对话记忆、上下文压缩和跨设备数据迁移的设计结论。规范性要求仍以 `openspec/changes/build-mobile-chat-pwa/specs/` 为准。

## 结论

- 首版只支持单个对话内的记忆，不创建或读取跨对话用户记忆、助手记忆或项目记忆。
- IndexedDB 中的消息是会话事实来源；上下文检查点是可重建的派生数据。
- OpenAI-compatible 请求以 `store: false` 和本地构建上下文为可靠基线。
- 首版放弃 provider store、`previous_response_id` 和 provider conversation 方案；返回的 ID 只可作为调试信息保存。
- 上下文压缩引用 `context-compression` 功能助手，支持前台自动触发和类似 `/compact` 的手动触发。
- 调试模式可显示上下文预算、各来源占比、provider usage 和可用的缓存命中统计。
- 完整跨设备迁移使用 ZIP-compatible `.mobilechat` 压缩包，不复制浏览器内部 IndexedDB 文件。

## 为什么放弃 provider store

模型只会看到当前推理请求所提供的上下文。服务端存储 Response、保留聊天产品历史、生成长期 Memory 是三个不同层次的机制。

OpenAI Responses API 可以手动重传历史，也可以用 `previous_response_id` 串联服务端 Response，还可以通过 Conversations API 持有 provider 侧 conversation 对象；即使使用 `previous_response_id`，历史输入仍计为输入 token。OpenAI 同时提供可在 `store: false` 下回传并继续携带的 compaction item。这表明持久对话的关键仍是调用方掌握可继续构建的上下文表示，而不是假设模型本身记住了上一轮。MobileChat 首版选择只实现本地上下文构建，不把 provider store 或 continuation 暴露成产品能力。

Claude Messages API 更明确地采用无状态设计：每轮发送完整的会话历史。Claude 的服务端 compaction 会返回一个 compaction block，后续请求仍由客户端把该块连同新消息回传。两类 API 都支持“客户端持有会话状态”的可靠模式。

参考：

- [OpenAI Conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
- [OpenAI Compaction](https://developers.openai.com/api/docs/guides/compaction)
- [Claude Using the Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages)
- [Claude Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)

## MNAPI 状态能力探测

探测日期：2026-07-13  
端点：`https://api.mnapi.com/v1`  
用于有效探测的模型：`gpt-5.4`

| 探测 | 结果 | 解释 |
|---|---:|---|
| `GET /models` | 200 | 网关与凭据可用 |
| 普通 `POST /responses`, `store:false` | 200 | Responses 基线可用 |
| `POST /responses`, `store:true` | 200，返回 Response ID | 参数被接受，但不能单独证明状态语义 |
| `GET /responses/{id}` | 404，路由无效 | 网关不提供 Response 取回 |
| 仅通过 `previous_response_id` 复述唯一随机标记 | HTTP 200，但未复述标记 | 上下文连续性未实现或不可用 |

因此首版将 MNAPI 的 provider continuation 标记为不支持。能力探测必须验证唯一内容的实际回忆，不能只检查 HTTP 成功、字段被接受或 Response ID 是否存在。

启动器当前配置的 `gpt-5.4-codex-high` 不在本次 `/models` 返回列表中，对该模型请求返回 503。它属于模型路由兼容问题，与 `store` 能力结论分开记录。

## 单对话 Memory 的含义

MobileChat 首版中的 Memory 不是独立的跨会话数据库，而是以下三层：

1. `messages`：完整、规范、不可因压缩而删除的对话消息和分支关系。
2. `ContextCheckpoint`：由压缩助手生成、覆盖到某个活动路径消息边界的继续上下文。
3. recent raw tail：检查点边界之后保留原文的近期消息。

每次聊天请求使用：

```text
当前聊天助手 prompt
+ 最新对话标题
+ 最新有效 contextSummary
+ 本地算法选择的原文锚点（可选）
+ 检查点之后的活动路径原始消息
+ 最新用户消息
```

标题单独动态注入，不写入检查点，所以改标题不会触发重新压缩。检查点覆盖的旧消息不再重复发送给模型，但仍完整保存在本地并继续显示。本地算法锚点只能选择原始消息片段并带上 message ID，例如用户 pin 的消息或关键词命中的片段；它不能改写或总结语义。

ChatGPT 和 Claude 产品中的 Memory 属于更高一层的产品功能：它们可以从多次聊天中提取或检索相关信息，再放入新请求的上下文。MobileChat 首版明确不实现这一层。

## 缓存命中率与预算表盘

表盘分为发送前估算和返回后观测两类数据。

发送前由本地 `ContextBudgetReport` 计算：

```text
sectionEstimatedTokens = estimate(sectionTextOrParts)
totalEstimatedTokens = sum(sectionEstimatedTokens)
sectionShare = sectionEstimatedTokens / totalEstimatedTokens
```

section 至少包括：

- 当前聊天助手 prompt
- 应用元数据，例如标题和边界说明
- `contextSummary`
- 本地算法锚点
- 用户原文消息
- 助手原文消息
- 最新用户输入

origin 至少区分：

- `configPrompt`：当前聊天助手配置
- `appMetadata`：应用生成的标题、边界、格式说明
- `utilitySummary`：压缩助手生成的上下文摘要
- `algorithmicAnchor`：本地算法选出的原文片段
- `userRaw`：用户原文
- `assistantRaw`：历史助手原文

因此“助手参与比例”不能只算一个数。应分别显示：

```text
currentAssistantPromptShare
historicalAssistantRawShare
utilitySummaryShare
algorithmicAnchorShare
```

返回后由 adapter 归一化 provider usage：

```text
inputTokens
outputTokens
totalTokens
cachedInputTokens
cacheWriteTokens
reasoningTokens
```

单次请求 cache 读命中率（仅当 `inputTokens > 0` 时计算）：

```text
cacheReadHitRate = cachedInputTokens / inputTokens
```

对话滚动 cache 读命中率（仅当分母大于 0 时计算）：

```text
rollingCacheReadHitRate = sum(cachedInputTokens) / sum(inputTokens)
```

cache 写入比例：

```text
cacheWriteRate = cacheWriteTokens / inputTokens
```

这些 cache 指标只能在 provider 或中转站返回对应 usage 字段后显示。请求前只能显示“预计可缓存前缀 token”，不能称为命中率。若 usage 或 cache 字段缺失，表盘显示 unknown/unsupported。

成本估算需要每个模型配置价格分类，例如未缓存输入、缓存输入、cache write、输出、reasoning。没有价格配置时只显示 token；有价格配置时也标记为 estimate，不作为账单。

调试模式默认关闭。启用后，对话页可显示最新请求的 `ContextBudgetReport`、最新响应的 `UsageStats`、cache 读写指标、压缩触发原因、活动 checkpoint、raw tail 边界、算法锚点 message ID 和 adapter 诊断。API key 和 Authorization header 不输出。

## 压缩助手与 `/compact` 风格流程

助手分为：

```text
chat     在用户可见对话中回复
utility  为应用功能产生语义派生数据
```

上下文压缩策略引用一个 `utilityRole: context-compression` 的功能助手。压缩助手有自己的 prompt、模型绑定和来源快照；它的请求与输出不作为普通消息写入对话流。

触发方式：

- 完成若干轮后在前台自动触发。
- 预计下一次输入接近配置的 token 阈值时触发。
- 用户点击 **Compact context** 手动触发，语义上对应 `/compact`。

增量压缩输入由上一个 `contextSummary`、上一个边界之后且位于新截断点之前的消息组成；配置数量的近期轮次继续保留原文。一次调用输出：

- `contextSummary`：供后续对话继续使用的详细状态。
- `displaySummary`：供历史列表和标题/摘要模糊搜索使用的短摘要。

成功后创建不可变检查点并原子切换当前引用。失败时保留旧检查点、完整消息和聊天回复。若用户编辑旧消息或切换到在检查点前分叉的路径，该检查点对新活动路径失效，应用从原始消息重建并重新压缩。

## `.mobilechat` 跨设备迁移包

规范格式是扩展名为 `.mobilechat` 的 ZIP-compatible 容器：

```text
manifest.json
records.json
blobs/<blob-id>
checksums.json
```

- `manifest.json`：导出格式版本、应用版本、导出时间和导出选项。
- `records.json`：API profiles、助手、对话、消息、检查点和设置。
- `blobs/`：可选附件原始二进制，避免 Base64 体积膨胀。
- `checksums.json`：各条目完整性校验。

完整迁移模式在用户明确确认后包含 API Key；无凭据模式保留 profile/model 元数据但清空秘密字段。浏览器持久文件句柄不导出。

导入必须先隔离解析并验证 ZIP 路径、校验值、格式版本、schema、内部引用与 blob 元数据，再显示预览，最后执行事务性覆盖或带 ID 重映射的合并。跨设备访问指手动导出、传输和导入，不代表实时同步。

不选择原始 IndexedDB 或 SQLite 文件作为交换格式，因为 IndexedDB 的磁盘表示由浏览器实现决定，静态 PWA 不能可靠地跨浏览器复制和恢复内部数据库文件。
