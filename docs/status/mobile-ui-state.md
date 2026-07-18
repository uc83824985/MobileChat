# Mobile UI state

Date: 2026-07-17

## Current verified state

- The mobile/desktop shell is usable with persisted local state.
- Conversation creation, conversation selection, title edit, title/summary search, archive action, archived conversation view, draft input, send, stop, debug panel toggle, settings open/close, theme switch, streaming switch, assistant switch, and model switch are covered by automated tests.
- Settings is no longer a placeholder. It exposes persisted connection, model, assistant, context configuration, backup, theme, and streaming controls.
- The app has OpenAI-compatible Responses and Chat Completions request loops. Responses sends `POST {baseUrl}/responses` using `store:false` and omits optional `metadata` for wider relay compatibility; Chat Completions sends `POST {baseUrl}/chat/completions`. Without an API key it shows a local configuration error. Streaming mode uses SSE text deltas when the gateway truly streams; if a `stream:true` request is buffered into JSON, the client falls back to one-shot JSON parsing.
- Mobile browser compatibility is covered by responsive CSS plus Playwright Mobile Chrome checks. The default mobile layout keeps the side conversation rail as a drawer, collapses settings/detail grids to one column, and preserves the same application logic as desktop.
- Repeated phone deployment now defaults to an Android WebView APK instead of a file-manager/browser shortcut. The wrapper is labelled **对话助手**, uses fixed package `com.uc83824985.mobilechat`, fixed WebView origin `https://appassets.androidplatform.net`, fixed entry `/app/index.html`, and the existing `MobileChatDB` database name. The deploy script installs with `adb install -r -d` and does not uninstall or clear app data. The launcher icon is generated from `android/Icon.jpg` and can be updated without changing the storage bucket.
- A persisted "布局模式" display setting supports `auto`, `mobile`, and `desktop`. `auto` follows viewport width, `mobile` forces drawer/single-column layout, and `desktop` forces the desktop layout structure. This is layout-only and does not change conversation state, local persistence, request construction, or provider protocol behavior.
- Settings includes an Android-app-only **沉浸显示（Android）** switch. It is persisted in `MobileChatDB` and sent to the native WebView wrapper through a small JavaScript bridge; the wrapper hides system bars and allows content to extend into short-edge cutout areas. Desktop browsers and ordinary web/PWA launches ignore it and keep normal window chrome.
- Theme, layout, and Android status-bar preference still persist in `MobileChatDB`, but the app also mirrors these startup-sensitive UI preferences to `localStorage` and applies theme in a small head boot script. This avoids a first-paint light/dark flash while keeping IndexedDB authoritative for domain data.
- Connection compatibility is protocol-specific. A user-configured Grok connection was observed to fail with 404 on Responses while succeeding on Chat Completions, so each connection must preserve the selected protocol instead of assuming one relay-wide default.
- Web access is protocol-specific and turn-scoped: Responses sends `tools: [{ type: "web_search" }]`; Chat Completions sends `web_search_options: {}` only when the composer's current-turn web option is enabled.
- Real-device API success still depends on the gateway allowing browser CORS. If CORS is blocked, a static-only deployment cannot complete the request without a proxy.
- Web access is wired as a composer-level temporary request option rather than a static model toggle. First-stage image input is wired through the composer: the image button opens one file-pick request without acting as a highlighted toggle; desktop paste reads image files from `Ctrl+V`; selected images are previewed locally, stored in the `blobs` store as image cache records, attached to the user message as lightweight references, and serialized into OpenAI-compatible Responses / Chat Completions image content parts when sent. Non-image file input is still not implemented.
- The composer is a multi-line textarea that grows with content up to a bounded height. A persisted **换行规则** setting uses concise UI choices, **Enter 发送** or **Enter 换行**; the alternate action remains available through the control-key path, and desktop `Ctrl+J` still inserts a newline.
- Debug mode exposes a per-message **朗读** action. The first pass calls a fixed local TTS playback endpoint using the documented `tts_speak` shape with `mode: "replace"`, so a later read request interrupts current playback and replaces pending speech. This is intentionally not persisted yet; endpoint and voice options remain future settings work.

## Implemented response to mobile feedback

- Assistant selection uses a native `<select>` in the chat header.
- Model selection is a second native `<select>` and is limited to the currently selected assistant's allowed model bindings.
- The settings panel is full-screen on small screens and a wide details panel on desktop.
- The conversation drawer keeps the bottom archive/settings actions visible while the conversation list scrolls.
- Desktop layout now uses the same pinned rail principle: the app shell is fixed to the viewport, the conversation history list scrolls inside the sidebar, and archive/settings actions remain pinned at the bottom instead of sharing the page scrollbar with the message area.
- Mobile layout has a floating conversation-drawer entry, and both mobile and desktop layouts have a floating top/bottom message-thread shortcut so long conversations do not require scrolling back to the header for navigation.
- The floating scroll control target is derived only from the current scroll position. Clicking it triggers smooth scrolling but no longer flips its own state immediately, avoiding a brief top/bottom flicker while the browser is still scrolling.
- The chat header provides a direct title edit entry. Press Enter or the check button to save; Esc or the close button cancels.
- Archived conversations now have a sidebar entry. The archived view searches only title and summary, allows browsing and restoring, and keeps the composer read-only until restore.
- Assistant messages expose a retry action; retry removes the selected assistant reply and later messages before regenerating with the current assistant/model. Messages also expose a local delete action.
- Message text preserves returned line breaks and indentation in the renderer and wraps long URLs/tokens. The client does not semantically rewrite or strip provider-returned search traces unless a future adapter exposes structured search/citation diagnostics that can be rendered separately.
- Dark mode styles native select options and applies `color-scheme: dark` to avoid white dropdown backgrounds with pale text.
- Native select popups have been replaced by a reusable custom combobox/listbox component, so selected options use the same green `--selected` background as conversation and card selections across dark and light themes.
- The assistant details panel is schema-rendered from `assistantFields`, so newly added assistants use the same reflected editor instead of a special hard-coded page.
- Settings directory lists expose up/down reorder controls for context configurations, connections, models, and assistants. Assistant records are split into chat assistant and utility assistant sections, and reordering is constrained within each section. Reordering changes display/default order only; object IDs and cross-record references remain stable.
- API Key editing uses an app-owned persistent show/hide button instead of relying on browser-specific password-field eye icons.
- Settings overview no longer reserves cards for normal save-state or count-only summaries. Autosave remains automatic; only failures, storage risk, and backup/import/export state need visible action.
- Settings detail panels colocate record actions with the edited record header where practical. Delete labels are object-specific: connection, model, assistant, context configuration, and probe records use separate wording instead of one generic delete action.
- Debug mode exposes a manual **总结上下文** action and a **显示总结** preview. Summary generation calls the configured global context-summary utility assistant, applies the current chat assistant's context configuration, stores the generated active rolling summary on the conversation, and keeps the visible message thread unchanged except for a small debug status hint.
- Debug mode also exposes a read-only **数据检查器**. It shows current database/state counts, the active conversation record, the current summary diff, messages covered by the summary boundary, retained raw tail messages, next-request projected messages, and read-only JSON dumps. This is intended for development validation before any editable DB inspector is introduced.
- Manual debug summary no longer blocks solely because the message count is below the raw-tail retention threshold. The retained raw-tail message count is a persisted setting, defaults to 8, and is clamped to 0–50. When the conversation is shorter than the configured tail size, the UI shows a warning status but still executes the user-requested summary action; only an empty completed-message set is skipped.
- Automatic context summary is enabled by a persisted **自动总结间隔** setting. `0` disables it; otherwise, after a chat/retry/regenerate response completes, the app counts completed text messages after the active summary boundary and starts a non-blocking summary job when the count reaches the interval. The job summarizes only the trigger-time message snapshot, so later user turns remain visible raw tail until a later trigger.
- When an active summary already exists and its boundary is still present, the next summary request includes the previous summary plus only the newly completed raw messages after that boundary. The result replaces the single active rolling summary and advances the boundary; canonical messages remain unchanged.
- Settings has an explicit built-in feature reference for **上下文总结助手**. The utility kind only makes an assistant eligible; feature settings decide which utility assistant is used by the built-in summary operation.
- Utility assistants have a model strategy. The default strategy is **跟随当前对话模型**, so context summary can run with the same connection + model as the active chat without extra setup. Switching a utility assistant to **指定模型** reveals its own allowed-model/default-model editor as an explicit override.
- Settings exposes the fixed five-section context-summary framework. Users can override each section's system description, restore one section, or restore all default descriptions; section IDs and titles remain app-defined.
- Settings also exposes reusable **上下文配置** records. A chat assistant references one context configuration; each configuration keeps the fixed five dimensions but can add per-dimension business/domain guidance, such as roleplay formatting rules, relationship/emotion tracking, random events, or task-specific exploration notes.
- Each context configuration also owns a summary character budget. Model records no longer carry context-budget or summary-size policy; per-scenario summary size is controlled by the chat assistant's referenced context configuration.
- Each context configuration dimension has an explicit enable checkbox. Disabled dimensions stay visible and keep any previously edited text as local preview data, but they are greyed out, cannot be edited until re-enabled, and are excluded from regular chat injection and summary prompts.
- The context configuration page includes a lightweight two-step agent-assisted workflow. Users first copy a start prompt that explains MobileChat's five fixed dimensions and asks the agent to discuss a new purpose-specific context configuration in natural language. The start prompt is intentionally convergent: it asks for one recommended direction, caps clarification questions and alternatives at three, and avoids large option menus. After the discussion is settled, users copy an export prompt that asks the agent for a parseable Markdown/JSON standard output, paste that output into the configuration parse area, and create a new Context Profile from the JSON without overwriting the current profile. The parse area is cleared after either a successful or failed parse attempt.

## Connection and model configuration

- User-facing terminology is normalized around **连接 / 模型 / 助手 / 上下文配置**. The internal data type is still named `apiProfiles` during the prototype phase to avoid mixing UI wording cleanup with schema churn.
- `apiProfiles` are stored independently in `MobileChatDB`.
- Each connection owns:
  - display name and description;
  - `baseUrl`;
  - local `apiKey`;
  - protocol, currently `openai-responses` or `openai-chat-completions`;
  - editable model definitions.
- Each model owns:
  - model ID / slug;
  - display name;
  - description;
  - enabled flag.
- Default and newly created connections start with an empty model list. The app does not seed a built-in "default model"; users create usable model records from successful probe results or by explicitly adding a model.
- The connection editor shows the full model list as selectable model cards, so every model visible in assistant model access can be traced back to a model-side configuration record.
- Assistants own model bindings that reference existing connection + model records, with snapshots of key display fields for provenance. Chat assistants always use their own allowed-model/default-model selection. Utility assistants default to following the active chat model and only use their own model bindings when their model strategy is set to fixed. Chat assistants also reference a reusable context configuration; utility summary assistants remain global and read the active chat assistant's configuration at execution time.
- Model probing is a separate settings workbench. Probe configurations generate candidate model IDs from structured version ranges and suffix segments, reuse the currently selected connection for execution, hide failed candidates from the result list, and offer one-click creation of successful model IDs under that connection. Creating a model from a probe does not bind it to an assistant or change the current conversation model.

## User-owned connection configuration

- The repo no longer seeds a concrete relay URL, API key, or model slug. First-run data contains a generic editable connection and model placeholder.
- User-specific connections and provider-specific model slugs should be created through the settings UI, import flow, or a local-only MobileChatDB update. Newly created connections and models default optional descriptions to empty strings.
- API keys remain in the browser's IndexedDB unless the user exports with credentials in a future explicit flow.
- CRUD status: connections, model definitions, assistants, context configurations, active conversations, and archived conversations all expose create/read/update/delete flows in the UI. Deleting the last required runtime object creates a blank local fallback so the app remains operable.
- Conversation deletion uses a confirmation prompt before permanently removing the conversation and its owned messages.
- Single-message deletion uses a separate confirmation prompt. UI terminology distinguishes large conversation containers as "对话" and individual records inside a conversation as "消息".

## Persistence and import/export

- `MobileChatDB` stores settings, API profiles, assistants, reusable context configurations, conversations, messages, drafts, context summaries, and image blobs. The current `blobs` implementation stores first-stage image cache records as data URLs plus metadata.
- Messages can include `imageParts[]` that reference `blobs` records by ID. Clearing image cache keeps message records and image placeholders, but removes preview/retry image payloads. The UI renders missing images as **图片缓存已清理**, and later requests send an explicit text placeholder instead of an empty or missing image object.
- Messages now store `createdAt`, assistant `completedAt`, and assistant `elapsedMs` where available. They are rendered chronologically by creation time, while completed assistant responses show finish time and request duration.
- Conversations may store `contextSummaries[]` plus `activeContextSummaryId`. The current implementation still manages one active rolling summary, but each record already keeps kind, status, boundary message ID, covered message count, retained raw tail count, framework snapshot, context configuration snapshot, update time, and summary-assistant/model source snapshot.
- Context summary output is locally budget-checked against the active context configuration. Over-budget summaries trigger one rewrite attempt; if the rewrite is still empty or over budget, the app keeps the previous active summary.
- During rapid iteration, persistence accepts only the current MobileChatDB record shape. Older fields are not translated into current configuration; users may reconfigure local profiles/assistants if a breaking schema change lands before the stable version.
- UI edits update memory immediately and are autosaved after a short debounce. Settings close and page visibility changes flush the latest snapshot.
- Top-level settings list order is explicit state. `apiProfileOrder` and `assistantOrder` are stored in settings and used to re-sort records after IndexedDB `getAll()`, because object stores return primary-key order rather than last UI display order.
- Settings persist the selected theme, layout mode, composer shortcut mode, context-summary raw-tail retention count, automatic summary interval, and whether Responses streaming is enabled.
- The current implementation persists normalized full snapshots. This is acceptable for the current small prototype; future large histories should move to dirty-record writes as specified in the architecture document.
- `.mobilechat` archives contain `manifest.json`, `records.json`, and `checksums.json`.
- The current export path is credential-free: connection metadata and model definitions are exported, but `apiKey` is cleared.
- The current default export also excludes image cache blobs to avoid unexpectedly large backups. Message image references remain in records as placeholders; a future explicit media-inclusive export can preserve image payloads.
- Desktop Playwright verifies title edit → settings edit → autosave → reload → export → local mutation → import → restored records with API key removed.

## Diagnostics and usage display

- The pre-send token count is still a local estimate based on text length, not a tokenizer-accurate billable number.
- The post-send usage display is intentionally compact: `cache cached/input`.
- A display such as `cache 0/95` means no cached input tokens were reported for 95 provider-reported input tokens. It is not total usage, output usage, or cost.
- A display such as `cache 未返回/989` means the endpoint returned the input-token denominator but omitted the cached-input numerator. It is an unsupported/unknown cache metric, not proof that 989 tokens all missed cache.
- Full provider usage is still stored on the assistant message record for future cost and budget panels.

## Web access and multimodal route flags

- For an OpenAI-compatible Responses route, web access requires an explicit tool configuration such as `tools: [{ "type": "web_search" }]`. MobileChat sends it only when the current composer turn enables “联网”.
- Prompting “请联网查询” is not sufficient if the request does not declare a search tool or the selected model route does not support it.
- Image file input currently uses `accept="image/*"` for mobile/desktop file pickers and also supports desktop clipboard paste, with a first-stage safety cap of 4 images per turn and 8 MB per image. Adding images appends body references such as `[图片1]`; draft thumbnails and message-record thumbnails open an in-app preview dialog and display `图片1 · filename` instead of internal IDs. When an attached image has a live cache record, Responses receives `input_image` parts and Chat Completions receives `image_url` parts, with an adjacent text part such as `附件 [图片1] 对应下面这张图片...` so the model can map the textual placeholder to the binary image content by label and order. If the cache was cleared, requests and summaries fall back to text placeholders such as `[图片1：name，mime，size]`.
- The Android WebView wrapper implements `onShowFileChooser`, so the same image picker path works inside the APK shell.
- Context summary jobs do not receive image data URLs. They receive only image metadata placeholders, so image-only messages can still be summarized without inflating summary requests with binary payloads.
- Streaming can be requested by sending `stream: true`, but true incremental display still requires the gateway to flush SSE events. If the gateway returns JSON, MobileChat falls back to one-shot display.
- Enabling web access can legitimately increase response latency because the provider or relay may perform hosted search/tool execution before producing the final assistant text. Successful searched responses are therefore not treated as an implementation error solely because they are slower than non-search turns.
- Debug diagnostics fold current-turn options into the pre-send budget card, for example `模型名 · 联网 · 仅文本` or `模型名 · 不联网 · 2 图`, instead of rendering a separate transient-options card.
- When a valid `contextSummary` exists, the debug input estimate is based on the projected request (`contextSummary` plus raw tail) rather than the full visible message list.
- Conversation titles are request metadata and are not semantic memory. Summary requests may receive the title/list summary as positioning context, but the prompt explicitly tells the summary assistant not to write them into the summary body unless the user is discussing those fields as business facts.

## Verification

- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run test:browser`

Current automated coverage includes Desktop Chrome and Pixel-class Mobile Chrome projects.

## Remaining limitations

- No endpoint validation button yet.
- No authoritative model discovery (`GET /models`) dependency exists. The settings probe workbench can test user-maintained candidate rules, but provider-visible model lists may still need manual curation.
- Context reduction is handled through the rolling context summary mechanism; no separate context-reduction feature is planned in the current design.
- No credential-including export flow yet; current export deliberately removes API keys.
- No CORS workaround exists in the static deployment. If the selected relay rejects browser origins, a proxy route is required.
