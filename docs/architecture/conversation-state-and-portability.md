# 会话状态、上下文压缩与数据迁移

本文记录 MobileChat 首版关于会话状态、单对话记忆、上下文压缩和跨设备数据迁移的设计结论。规范性要求仍以 `openspec/changes/build-mobile-chat-pwa/specs/` 为准。

## 结论

- 首版只支持单个对话内的记忆，不创建或读取跨对话用户记忆、助手记忆或项目记忆。
- IndexedDB 中的消息是会话事实来源；上下文检查点是可重建的派生数据。
- OpenAI-compatible 请求以 `store: false` 和本地构建上下文为可靠基线。
- 首版放弃 provider store、`previous_response_id` 和 provider conversation 方案；返回的 ID 只可作为调试信息保存。
- 上下文压缩引用 `context-compression` 功能助手，支持前台自动触发和类似 `/compact` 的手动触发。
- 调试模式可显示上下文预算、各来源占比、provider usage 和可用的缓存命中统计。
- 本地持久化统一使用名为 `MobileChatDB` 的 IndexedDB 数据库；配置、助手、API profiles、对话和后续附件均进入同一版本化 schema。
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

## 历史中转站状态能力探测记录

探测日期：2026-07-13  
端点与模型：用户本机曾配置的一个 OpenAI-compatible relay 和模型路由。

| 探测 | 结果 | 解释 |
|---|---:|---|
| `GET /models` | 200 | 网关与凭据可用 |
| 普通 `POST /responses`, `store:false` | 200 | Responses 基线可用 |
| `POST /responses`, `store:true` | 200，返回 Response ID | 参数被接受，但不能单独证明状态语义 |
| `GET /responses/{id}` | 404，路由无效 | 网关不提供 Response 取回 |
| 仅通过 `previous_response_id` 复述唯一随机标记 | HTTP 200，但未复述标记 | 上下文连续性未实现或不可用 |

因此首版将该类 relay 的 provider continuation 默认标记为不支持。能力探测必须验证唯一内容的实际回忆，不能只检查 HTTP 成功、字段被接受或 Response ID 是否存在。

仓库不再内置该中转站、模型 slug 或任何个人路由配置。此记录只保留为历史兼容性观察；模型 slug 的可用性以用户本机数据库中的实际配置和网关返回为准。

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

## `MobileChatDB` 本地持久化策略

首版本地数据库命名为 `MobileChatDB`。PC 和手机使用同一套 IndexedDB repository，不为手机实现单独存储路径。

规范对象仓库：

```text
MobileChatDB
├─ meta
├─ settings
├─ apiProfiles
├─ assistants
├─ conversations
├─ messages
├─ drafts
├─ contextCheckpoints
└─ blobs
```

其中：

- `meta`：数据库 schema 版本、迁移状态、应用版本兼容信息。
- `settings`：当前助手、当前模型引用、当前对话、主题模式、流式输出开关、调试模式、存储持久化状态、最后成功导出时间等应用设置。
- `apiProfiles`：API base URL、协议、凭据、模型列表和价格/上下文窗口元数据。模型是独立记录，不应只作为助手字段存在。
- `assistants`：聊天助手和功能助手配置，包括 prompt、初始消息和模型绑定。助手引用已有 API Profile + model，并保存关键显示字段快照，避免模型或助手删除后消息来源完全丢失。
- `conversations`：标题、显示摘要、归档状态、活动助手/模型引用、活动检查点引用。归档不是移动到另一张表，而是通过 `archived=true` 在同一数据集中切换到只读浏览/搜索/恢复视图。
- `messages`：规范消息、创建时间、助手回复完成时间、浏览器观测耗时、content parts、分支关系、助手/模型来源快照、usage/debug 观测。渲染顺序必须基于 `createdAt` 或显式序号，不能依赖 IndexedDB `getAll()` 的主键顺序，因为 `assistant-*` / `message-*` 前缀会破坏真实对话顺序。
- `drafts`：每个对话的未发送草稿。
- `contextCheckpoints`：不可变压缩检查点。
- `blobs`：后续多模态附件的二进制内容和元数据。

写入策略采用“内存优先、后台持久化”：

1. 用户操作先更新 React 内存状态，保证输入和点击立即反馈。
2. repository 只异步写入被修改的 dirty record，不序列化整库。
3. select、checkbox、新增/删除等离散操作立即提交。
4. 文本输入使用 300–500ms debounce；失焦、关闭设置页、发送消息和页面隐藏时 flush。
5. 对话消息、导入替换、删除、归档、检查点切换等需要一致性的操作使用 IndexedDB transaction。
6. UI 显示轻量保存状态：`未保存`、`保存中`、`已保存`、`保存失败`。失败时保留内存状态并提示重试或导出。

当前首版实现为 normalized full snapshot autosave：每次保存会重写 settings、apiProfiles、assistants、conversations、messages 这些小规模 domain stores。该方案足以验证手机端持久化和导入导出；当消息历史、附件或检查点变大后，应切换到上面的 dirty record 写入策略。

IndexedDB 是异步 API，正常的小记录写入不应阻塞主线程。手机端卡顿主要来自错误实现：每次输入都序列化大对象、同步写 `localStorage`、在 React render 中等待写库、或跨 store 做过大事务。首版禁止这些模式。若实机发现低端设备在 prompt 大文本编辑时卡顿，可把文本字段改为“失焦保存 + 手动保存”或增加 debounce；默认仍采用无感自动保存。

首次完成配置后，应用应调用 `navigator.storage.persist()` 请求 persistent storage，并用 `navigator.storage.estimate()` 在设置/调试区显示用量、quota 和持久化状态。即使请求成功，用户清理站点数据、卸载浏览器或更换 origin 仍会导致本地数据不可用，所以 `.mobilechat` 导出仍是必要兜底。

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

UI 展示必须避免把 cache 命中分子/分母误写成总 usage。当前首版调试面板只显示最容易误读的一项：

```text
cache <cachedInputTokens>/<inputTokens>
```

其中 `cache 0/95` 只表示本次 95 个输入 token 中 provider 报告 0 个 cached input tokens，不代表总 token 为 95，也不代表输出 token 为 0。

完整 `inputTokens`、`outputTokens`、`totalTokens`、`cachedInputTokens` 仍保存在消息记录上，后续成本面板或高级调试面板可以恢复展示。

对话滚动 cache 读命中率（仅当分母大于 0 时计算）：

```text
rollingCacheReadHitRate = sum(cachedInputTokens) / sum(inputTokens)
```

cache 写入比例：

```text
cacheWriteRate = cacheWriteTokens / inputTokens
```

发送前也显示本地 cache 估算，但必须标记为 estimate，并和返回后的 observed 指标分开。发送前估算基于渲染后的请求前缀、模型/端点作用域和本地最近观测记录：

```text
cacheScope = apiProfileId + baseUrl + protocol + providerModelId + promptCacheKey? + requestShapeVersion
stablePrefixFingerprint = hash(renderedPrefixBeforeFirstVolatileSection)
potentialCacheableRate = cacheablePrefixTokens / estimatedInputTokens
estimatedCacheReadHitRate =
  recentSameScopeAndPrefix ? cacheablePrefixTokens / estimatedInputTokens : 0
```

`potentialCacheableRate` 用来调试上下文结构：如果这个值很低，说明标题、摘要、raw tail 或其他动态内容过早进入 prompt，破坏了可复用前缀。`estimatedCacheReadHitRate` 用来调试“这一次大概率是否命中”：只有本地记录里存在同 endpoint、同模型、同 request shape、同稳定前缀的近期请求时才给出非零估算。估算还要带 `confidence`：

- `high`：近期相同前缀请求返回过非零 `cachedInputTokens`。
- `medium`：近期相同前缀请求成功过，但 provider 没返回 cache usage。
- `low`：当前前缀理论可缓存，但本地没有近期相同前缀观测。
- `none`：provider 不支持或未声明 cache usage，或输入 token 分母不可用。

返回后观测仍以 provider usage 为准。若 usage 或 cache 字段缺失，observed 表盘显示 unknown/unsupported，不用发送前估算回填真实命中率。若端点返回输入 token 但未返回 cached input token，UI 可以显示 `cache 未返回/N` 作为“分母已知、分子未知”的状态；这不能等同于 `cache 0/N`。

助手消息还记录本地墙钟耗时：`createdAt` 是助手占位消息/请求开始时间，`completedAt` 是进入 complete、stopped 或 error 等终态的时间，`elapsedMs` 是浏览器观测到的持续时间。该耗时包含中转站排队、provider 延迟、联网工具执行、流式/缓冲行为和网络时间，只用于体验与调试，不是 provider 账单指标。

成本估算需要每个模型配置价格分类，例如未缓存输入、缓存输入、cache write、输出、reasoning。没有价格配置时只显示 token；有价格配置时也标记为 estimate，不作为账单。

调试模式默认关闭。启用后，对话页可显示最新请求的 `ContextBudgetReport`、最新响应的 `UsageStats`、cache 读写指标、压缩触发原因、活动 checkpoint、raw tail 边界、算法锚点 message ID 和 adapter 诊断。API key 和 Authorization header 不输出。

## 当前边界情况与需明确点

以下问题不阻塞首版，但实现时需要明确处理：

1. **token 估算误差**：发送前预算使用本地估算，provider 实际 usage 可能不同。UI 必须区分 estimated 和 observed。
2. **cache 估算误差**：本地只能根据近期相同前缀观测估算；provider 路由、TTL、限流、中转站实现和 prompt 细微变化都会导致实际命中不同。
3. **动态内容过早进入 prompt**：标题、时间、摘要、raw tail、调试标记等如果放在静态前缀前，会破坏 prefix cache。请求渲染应尽量保持“稳定说明 + 当前助手 prompt”在前，动态上下文在后。
4. **中转站 usage 缺失**：部分 relay 可能不返回 usage 或 cache 字段。此时只能显示本地预算和 unknown/unsupported，不能补假数据。
5. **多模态 token 估算**：图片、文件、未来音频/视频内容的 token 成本可能无法准确本地估算。预算表盘需要按 content part 标记 estimated/unsupported。
6. **算法锚点重复**：本地锚点可能和 raw tail 或 checkpoint 覆盖内容重复。构建 projection 时需要按 message ID 和 span 去重。
7. **算法锚点冲突**：关键词命中的旧消息可能已经在当前分支失效。锚点只能来自当前 active path，且不能跨 checkpoint 无条件复用。
8. **checkpoint 质量漂移**：压缩助手可能遗漏或误写关键信息。完整原文必须保留，支持手动重新 compact，并在调试面板显示 checkpoint 来源和边界。
9. **分支与并发**：用户编辑旧消息、重新生成、多个标签页同时发送都可能改变 active leaf。首版应限制同一对话同一时间只有一个生成请求，或把并发请求显式分支化。
10. **部分响应无 usage**：用户中止、网络断开或 provider 流结束异常时，消息可保留 partial/interrupted 状态，但 usage/cache 观测应为 unknown。
11. **模型价格过期**：成本估算依赖用户维护的价格元数据，必须标记为 estimate，不作为账单。
12. **调试信息隐私**：除 API key 和 Authorization 外，请求正文也可能包含敏感内容。debug 面板默认只本地显示，完整 debug dump 不应默认导出。

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

完整迁移模式在用户明确确认后包含 API Key；无凭据模式保留 profile/model 元数据但清空秘密字段。当前已实现的是无凭据导出：`.mobilechat` 会保留 API Profile、模型、助手绑定、对话和消息，但清空 `apiKey`。浏览器持久文件句柄不导出。

导入必须先隔离解析并验证 ZIP 路径、校验值、格式版本、schema、内部引用与 blob 元数据，再显示预览，最后执行事务性覆盖或带 ID 重映射的合并。跨设备访问指手动导出、传输和导入，不代表实时同步。

不选择原始 IndexedDB 或 SQLite 文件作为交换格式，因为 IndexedDB 的磁盘表示由浏览器实现决定，静态 PWA 不能可靠地跨浏览器复制和恢复内部数据库文件。

导入/导出和 `MobileChatDB` 共用同一套版本化 record DTO 与迁移逻辑：

```text
MobileChatDB records
→ export DTO validation
→ records.json / blobs / checksums
→ isolated import parse
→ import DTO migration + validation
→ MobileChatDB transaction replace or merge
```

导出从已提交的 IndexedDB snapshot 读取，显示估算大小、附件范围、是否包含 API key 和最后成功导出时间。导入先在内存中完成 ZIP 路径安全、checksum、schema、引用完整性和凭据策略校验；只有用户确认后才打开写事务。覆盖导入必须先验证成功，再清空并重建 domain stores。合并导入必须为冲突 ID 生成新 ID，并同步重写所有内部引用。
