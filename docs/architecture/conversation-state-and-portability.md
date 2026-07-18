# 会话状态、上下文总结与数据迁移

本文记录 MobileChat 首版关于会话状态、单对话记忆、上下文总结和跨设备数据迁移的设计结论。规范性要求仍以 `openspec/changes/build-mobile-chat-pwa/specs/` 为准。

## 结论

- 首版只支持单个对话内的记忆，不创建或读取跨对话用户记忆、助手记忆或项目记忆。
- IndexedDB 中的消息是会话事实来源；上下文总结是可重建的派生数据。
- OpenAI-compatible 请求以 `store: false` 和本地构建上下文为可靠基线。
- 首版放弃 provider store、`previous_response_id` 和 provider conversation 方案；返回的 ID 只可作为调试信息保存。
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

仓库不再内置该中转站、模型 slug 或任何个人路由配置。此记录只保留为历史路由观察；模型 slug 的可用性以用户本机数据库中的实际配置和网关返回为准。

## 单对话 Memory 的含义

MobileChat 首版中的 Memory 不是独立的跨会话数据库，而是以下三层：

1. `messages`：完整、规范、不可因总结而删除的对话消息和分支关系。
2. `ContextSummary`：由上下文总结功能引用的 utility 助手生成、覆盖到某个消息边界的轻量继续上下文。
3. recent raw tail：总结边界之后保留原文的近期消息。

首版不再引入独立的上下文检查点机制。上下文精简统一由 `ContextSummary` 承担：完整消息继续保留，后续请求只投影最新有效总结和总结边界之后的 raw tail。

每次聊天请求使用：

```text
当前聊天助手 prompt
+ 最新对话标题
+ 最新有效 contextSummary
+ 本地算法选择的原文锚点（可选）
+ 总结边界之后的活动路径原始消息
+ 最新用户消息
```

标题单独动态注入，不写入总结，所以改标题不会触发重新总结。总结覆盖的旧消息不再重复发送给模型，但仍完整保存在本地并继续显示。本地算法锚点只能选择原始消息片段并带上 message ID，例如用户 pin 的消息或关键词命中的片段；它不能改写或总结语义。

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
└─ blobs
```

其中：

- `meta`：数据库 schema 版本、应用版本和当前记录格式信息。
- `settings`：当前助手、当前模型引用、当前对话、主题模式、布局模式、Android 沉浸显示、流式输出开关、调试模式、上下文配置、顶层配置显示顺序、存储持久化状态、最后成功导出时间等应用设置。
- `apiProfiles`：用户界面称为“连接”；保存 API base URL、协议、凭据和模型列表。默认连接和新增连接不内置模型；模型是探测成功或用户显式新增后的独立记录，不应只作为助手字段存在；上下文预算策略由上下文配置持有。
- `assistants`：聊天助手和功能助手配置，包括 prompt、初始消息、模型绑定、功能助手模型策略和聊天助手引用的上下文配置。助手引用已有连接 + model，并保存关键显示字段快照，避免模型或助手删除后消息来源完全丢失。
- `conversations`：标题、显示摘要、归档状态、活动助手/模型引用、活动上下文总结引用。归档不是移动到另一张表，而是通过 `archived=true` 在同一数据集中切换到只读浏览/搜索/恢复视图。
- `messages`：规范消息、创建时间、助手回复完成时间、浏览器观测耗时、content parts、分支关系、助手/模型来源快照、usage/debug 观测。渲染顺序必须基于 `createdAt` 或显式序号，不能依赖 IndexedDB `getAll()` 的主键顺序，因为 `assistant-*` / `message-*` 前缀会破坏真实对话顺序。
- `drafts`：每个对话的未发送草稿。
- `blobs`：多模态附件缓存和元数据。当前首版图片实现用 data URL 存储图片缓存，消息只保存轻量 `imageParts[]` 引用和 `referenceLabel`（例如 `图片1`）；正文可用 `[图片1]` 引用对应图片。后续可将 payload 迁移为独立二进制条目以降低 Base64 体积。

写入策略采用“内存优先、后台持久化”：

1. 用户操作先更新 React 内存状态，保证输入和点击立即反馈。
2. repository 只异步写入被修改的 dirty record，不序列化整库。
3. select、checkbox、新增/删除等离散操作立即提交。
4. 文本输入使用 300–500ms debounce；失焦、关闭设置页、发送消息和页面隐藏时 flush。
5. 对话消息、导入替换、删除、归档、检查点切换等需要一致性的操作使用 IndexedDB transaction。
6. 常规 UI 不展示自动保存状态；保存失败时保留内存状态并在备份/提示区域显示错误，方便用户导出或重试。

IndexedDB object store 的 `getAll()` 按主键返回，不保留用户拖动后的数组顺序。因此连接和助手这类顶层独立 store 的显示顺序必须在 settings 中保存为 `apiProfileOrder`、`assistantOrder`，加载后再按该顺序重排。

当前首版实现为 normalized full snapshot autosave：每次保存会重写 settings、apiProfiles、assistants、conversations、messages 这些小规模 domain stores。该方案足以验证手机端持久化和导入导出；当消息历史、附件或检查点变大后，应切换到上面的 dirty record 写入策略。

IndexedDB 是异步 API，正常的小记录写入不应阻塞主线程。手机端卡顿主要来自错误实现：每次输入都序列化大对象、同步写 `localStorage`、在 React render 中等待写库、或跨 store 做过大事务。首版禁止这些模式。若实机发现低端设备在 prompt 大文本编辑时卡顿，可把文本字段改为“失焦保存 + 手动保存”或增加 debounce；默认仍采用无感自动保存。

首次完成配置后，应用应调用 `navigator.storage.persist()` 请求 persistent storage，并用 `navigator.storage.estimate()` 在设置/调试区显示用量、quota 和持久化状态。即使请求成功，用户清理站点数据、卸载浏览器或更换 origin 仍会导致本地数据不可用，所以 `.mobilechat` 导出仍是必要兜底。

手机端重复迭代的默认入口改为固定包名的 Android WebView 壳，而不是裸 `file://` / `content://` 文件快捷方式。WebView 壳必须从第一版起固定这些持久化关键常量：`applicationId = com.uc83824985.mobilechat`、签名 key、`https://appassets.androidplatform.net` origin、`/app/index.html` 入口路径和 `MobileChatDB` 数据库名。脚本只允许用 `adb install -r` 覆盖升级，不主动卸载、不清 app data。若更换签名 key 或包名，Android 会拒绝覆盖安装；若更换 WebView origin 或 IndexedDB 名称，旧数据仍在设备上但新代码看不到，表现为“数据丢失”。

Android 壳可以提供窄范围的可选 JavaScript bridge，用于仅在原生壳中有意义的显示行为。例如 **沉浸显示（Android）** 会调用 `MobileChatAndroid.setStatusBarHidden(...)`，隐藏系统栏并允许 WebView 扩展到横屏短边 cutout 区域；普通桌面浏览器、GitHub Pages PWA 和本地文件 smoke test 没有该 bridge，设置只会被持久化，不改变窗口或浏览器 chrome。

PC 端开发和网页访问继续使用普通浏览器 IndexedDB，不迁移到 Android 壳的私有 WebView 数据目录。PC origin、GitHub Pages origin、Android WebView origin 和历史裸文件入口都是相互独立的存储桶，跨桶迁移仍通过 `.mobilechat` 导出/导入完成。

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
- `utilitySummary`：上下文总结助手生成的继续上下文
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

调试模式默认关闭。启用后，对话页可显示最新请求的 `ContextBudgetReport`、最新响应的 `UsageStats`、cache 读写指标、活动上下文总结、raw tail 边界、算法锚点 message ID 和 adapter 诊断。API key 和 Authorization header 不输出。

## 当前边界情况与需明确点

以下问题不阻塞首版，但实现时需要明确处理：

1. **token 估算误差**：发送前预算使用本地估算，provider 实际 usage 可能不同。UI 必须区分 estimated 和 observed。
2. **cache 估算误差**：本地只能根据近期相同前缀观测估算；provider 路由、TTL、限流、中转站实现和 prompt 细微变化都会导致实际命中不同。
3. **动态内容过早进入 prompt**：标题、时间、摘要、raw tail、调试标记等如果放在静态前缀前，会破坏 prefix cache。请求渲染应尽量保持“稳定说明 + 当前助手 prompt”在前，动态上下文在后。
4. **中转站 usage 缺失**：部分 relay 可能不返回 usage 或 cache 字段。此时只能显示本地预算和 unknown/unsupported，不能补假数据。
5. **多模态 token 估算**：图片、文件、未来音频/视频内容的 token 成本可能无法准确本地估算。预算表盘需要按 content part 标记 estimated/unsupported。
6. **算法锚点重复**：本地锚点可能和 raw tail 或上下文总结覆盖内容重复。构建 projection 时需要按 message ID 和 span 去重。
7. **算法锚点冲突**：关键词命中的旧消息可能已经在当前分支失效。锚点只能来自当前 active path。
8. **总结质量漂移**：总结助手可能遗漏或误写关键信息。完整原文必须保留，支持手动重新总结，并在调试面板显示总结来源和边界。
9. **分支与并发**：用户编辑旧消息、重新生成、多个标签页同时发送都可能改变 active leaf。首版应限制同一对话同一时间只有一个生成请求，或把并发请求显式分支化。
10. **部分响应无 usage**：用户中止、网络断开或 provider 流结束异常时，消息可保留 partial/interrupted 状态，但 usage/cache 观测应为 unknown。
11. **模型价格过期**：成本估算依赖用户维护的价格元数据，必须标记为 estimate，不作为账单。
12. **调试信息隐私**：除 API key 和 Authorization 外，请求正文也可能包含敏感内容。debug 面板默认只本地显示，完整 debug dump 不应默认导出。

## 上下文总结助手与轻量投影

当前实现优先落地轻量 `ContextSummary`：

- 调试模式下显示 **总结上下文** 手动入口。
- 入口调用设置中 **上下文总结助手** 引用的全局 `utility` 助手；该助手有自己的 prompt、模型策略、可选模型绑定和来源快照。`utility` kind 只表示助手不可作为聊天发言者，不能单独决定它用于哪类内置语义任务。
- 功能助手模型策略默认为 **跟随当前对话模型**，即总结请求使用当前聊天窗口实际选中的连接 + 模型；当用户选择 **指定模型** 时，才启用该功能助手自己的允许模型和默认模型配置。
- 总结助手不按每个聊天助手单独配置。当前聊天助手引用一个上下文配置（内部类型仍为 `ContextProfile`），总结请求把该配置附加给全局总结助手，使同一个总结助手可复用于通用问答、角色扮演、资料整理、代码研究等场景。
- 模型配置不承载业务场景的总结长度策略。上下文配置持有 `summaryMaxChars`：普通助手可以使用较短总结，角色扮演、世界状态等高预算场景可以配置更长总结。
- 总结请求和输出不作为普通消息写入对话流，不刷新或追加前台消息，只在调试区域显示状态提示。
- 自动总结由 **自动总结间隔** 设置控制。`0` 表示关闭；非零时，在普通发送、重试、重答的助手回复完成后，应用统计 active summary 边界之后的已完成文本消息数量，达到间隔后启动一个不阻塞前台对话的总结任务。
- 自动总结只处理触发时的消息快照。例如第 8 条消息完成时触发总结，即使用户随后继续到第 10 条，返回结果也只覆盖到第 8 条；第 9–10 条继续作为 raw tail 保留，直到后续间隔再次满足。
- 当已有 active summary 且 boundary 仍存在时，下一次总结请求会带上旧 summary，并只合并 boundary 之后到本次触发点的新增原文段；输出替换为新的 active rolling summary，`previousSummaryId` 记录旧 summary ID。总结是预算内重写，不是追加流水账；如果输出超过当前上下文配置的 `summaryMaxChars`，本地会要求总结助手重写一次，仍超限则不启用新总结并保留旧 summary。
- 调试模式下可以通过 **显示总结** 展开当前保存的 `contextSummary`，用于确认后续请求会引用的总结内容。
- 调试模式下可以通过只读 **数据检查器** 查看当前数据库/前端状态概览、当前对话记录、summary diff、summary 边界覆盖的原文、保留的 raw tail、下一次请求投影，以及只读 JSON。首版只观察不写回，用于验证总结边界和投影是否符合预期，避免开发期直接编辑 IndexedDB 造成数据损坏。
- 成功后对话写入 `contextSummaries[]` 和 `activeContextSummaryId`。当前只维护一条 `rolling` active summary，但记录结构已保留 `kind`、`status`、`boundaryMessageId`、`coveredMessageCount`、`retainedRawMessageCount`、`framework` 快照、上下文配置快照、更新时间和来源快照，后续可扩展为多段 segment 和 merged summary。
- 后续请求投影为：当前聊天助手 prompt + 当前聊天助手的上下文配置指令 + 轻量 `contextSummary` + 总结边界之后的原文 tail + 最新用户输入。
- 如果删除了总结覆盖范围内的消息，应清除该对话的 `contextSummary`，避免引用过期语义。

对话标题和列表摘要属于请求级元数据，不属于语义记忆。总结请求可以把它们作为定位参考提供给总结助手，但必须明确要求不要写入总结正文；如果用户重命名对话，下一次普通请求通过最新标题生效，不需要重新生成 `ContextSummary`。

上下文总结框架由本地设置定义，并在调用总结助手时附加到 prompt。默认框架包含：

- 严格记忆：用户明确确认、后续必须遵守的规则、限制、长期偏好和架构/业务决策。
- 精确事实：可精确引用的事实、字段、路径、版本、模型、配置、数值、角色属性和世界规则；禁止保存 API key 原文。
- 模糊记忆：有参考价值但未完全确认的偏好、倾向、假设和背景判断，不得当作硬规则执行。
- 探索记录：已尝试方案、错误信息、观察结果、修复动作、验证结论和排除项。
- 当前状态：当前进度、未提交状态、待办、阻塞点、下一步计划和待用户确认事项。

这五个维度的 ID、标题和顺序作为系统级基向量固定；设置页只允许覆盖每个维度的系统描述，并提供单项还原和全部还原默认值。这样可以在保持总结输出结构稳定的同时，允许用户按自己的使用方式微调分类边界。

上下文配置是业务/场景层，独立于总结助手：

- 每个聊天助手引用一个上下文配置。
- 每个配置仍使用同一套五维度，只允许为各维度追加该业务场景的重载说明，不新增第六类业务维度。
- 每个维度有显式启用开关。关闭时，该维度从普通聊天注入和总结 prompt 中完全排除；已填写的重载说明仍保存在本地并可预览，但在重新启用前不可编辑且不参与实际请求。
- 例如角色扮演配置可把“严格记忆”重载为回复格式、禁忌和长期规则；把“精确事实”重载为角色外貌、性格、世界规则；把“模糊记忆”重载为关系温度和情绪趋势；把“探索记录”重载为随机事件、灵感分支和未确认素材；把“当前状态”重载为当前场景、即时心情和正在发生的事件。
- 普通聊天和主动总结都读取当前聊天助手的上下文配置。这样全局总结助手可以保持稳定，不需要为每个聊天助手复制一份总结助手配置。

设置页还保留一个上下文配置工作流草稿，用于 agent 辅助设计配置。该流程分两步：第一步复制“起始说明”到外部 agent，说明 MobileChat 的五个固定维度，并要求围绕某个特定用途自然语言讨论新上下文配置。起始说明应保持收敛式访谈：默认给一个推荐方向，每轮最多追问 3 个关键问题，备选项最多 3 个且必须标明推荐项，避免长菜单、完整模板和多路径分支。第二步在讨论收敛后复制“导出说明”，要求 agent 输出可解析的 Markdown/JSON 标准结果。解析动作只会新建一份 `ContextProfile`，不会覆盖当前配置；配置解析区随 settings 自动保存，但不会进入普通聊天请求、总结 prompt 或五维配置本体，并会在解析成功或失败后清空。

自动轻量总结已启用消息数间隔触发。后续仍可扩展空闲时间、单次长回复、发送前预算接近阈值等触发条件，但这些触发应继续保持前台可观测、不阻塞普通对话、失败不回滚聊天回复。

## 上下文总结作为唯一精简机制

首版只保留 `ContextSummary` 作为单对话上下文精简机制。用户感知上，目标是“把旧消息变短，并让后续对话继续接上”；为了降低配置复杂度和 UI 术语重叠，MobileChat 不再设计第二套助手、手动入口或持久记录结构。

后续优化方向是增强总结算法，而不是新增压缩机制：

- 让总结助手输出更稳定的结构化结果，并按当前上下文配置的字数预算重写合并旧信息。
- 从结构化结果中提取 `displaySummary` 更新左侧对话摘要。
- 保留 `boundaryMessageId`、覆盖条数、raw tail 条数和来源快照，确保可检查、可重新生成。
- 原始消息始终保留；删除总结覆盖范围内的消息时清除该总结。
- 暂不引入不可变检查点、分支版本或专用配置。

## `.mobilechat` 跨设备迁移包

快速迭代阶段不维护旧 schema 到新 schema 的完整迁移链。`MobileChatDB` 和 `.mobilechat` 导入均以当前记录结构为准；旧字段不会被翻译成当前配置。进入稳定版前再设计单向升级脚本和可恢复失败路径。

规范格式是扩展名为 `.mobilechat` 的 ZIP-compatible 容器：

```text
manifest.json
records.json
blobs/<blob-id>
checksums.json
```

- `manifest.json`：导出格式版本、应用版本、导出时间和导出选项。
- `records.json`：连接（内部字段仍为 API profiles）、助手、对话、消息、检查点和设置。
- `blobs/`：可选附件原始二进制，避免 Base64 体积膨胀。当前首版 `.mobilechat` 默认不导出图片缓存；只有未来显式启用媒体导出时才应包含该目录或等价媒体 payload。
- `checksums.json`：各条目完整性校验。

完整迁移模式在用户明确确认后包含 API Key；无凭据模式保留 connection/model 元数据但清空秘密字段。当前已实现的是无凭据导出：`.mobilechat` 会保留连接、模型、助手绑定、对话和消息，但清空 `apiKey`，并默认排除图片缓存以避免导出体积失控。浏览器持久文件句柄不导出。

导入必须先隔离解析并验证 ZIP 路径、校验值、格式版本、schema、内部引用与 blob 元数据，再显示预览，最后执行事务性覆盖或带 ID 重映射的合并。跨设备访问指手动导出、传输和导入，不代表实时同步。

不选择原始 IndexedDB 或 SQLite 文件作为交换格式，因为 IndexedDB 的磁盘表示由浏览器实现决定，静态 PWA 不能可靠地跨浏览器复制和恢复内部数据库文件。

导入/导出和 `MobileChatDB` 共用同一套版本化 record DTO 与迁移逻辑：

```text
MobileChatDB records
→ export DTO validation
→ records.json / blobs / checksums
→ isolated import parse
→ import current-schema DTO validation
→ MobileChatDB transaction replace or merge
```

导出从已提交的 IndexedDB snapshot 读取，显示估算大小、附件范围、是否包含 API key 和最后成功导出时间。导入先在内存中完成 ZIP 路径安全、checksum、schema、引用完整性和凭据策略校验；只有用户确认后才打开写事务。覆盖导入必须先验证成功，再清空并重建 domain stores。合并导入必须为冲突 ID 生成新 ID，并同步重写所有内部引用。
