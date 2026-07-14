# Mobile UI state

Date: 2026-07-14

## Current verified state

- The mobile/desktop shell is usable with persisted local state.
- Conversation creation, conversation selection, title edit, title/summary search, archive action, archived conversation view, draft input, send, stop, debug panel toggle, settings open/close, theme switch, streaming switch, assistant switch, and model switch are covered by automated tests.
- Settings is no longer a placeholder. It exposes persisted API Profile, model, assistant, context Profile, backup, theme, and streaming controls.
- The app has OpenAI-compatible Responses and Chat Completions request loops. Responses sends `POST {baseUrl}/responses` using `store:false` and omits optional `metadata` for wider relay compatibility; Chat Completions sends `POST {baseUrl}/chat/completions`. Without an API key it shows a local configuration error. Streaming mode uses SSE text deltas when the gateway truly streams; if a `stream:true` request is buffered into JSON, the client falls back to one-shot JSON parsing.
- Mobile browser compatibility is covered by responsive CSS plus Playwright Mobile Chrome checks. The default mobile layout keeps the side conversation rail as a drawer, collapses settings/detail grids to one column, and preserves the same application logic as desktop.
- A persisted "布局模式" display setting supports `auto`, `mobile`, and `desktop`. `auto` follows viewport width, `mobile` forces drawer/single-column layout, and `desktop` forces the desktop layout structure. This is layout-only and does not change conversation state, local persistence, request construction, or provider protocol behavior.
- Theme and layout still persist in `MobileChatDB`, but the app also mirrors those two paint-critical UI preferences to `localStorage` and applies theme in a small head boot script. This avoids a first-paint light/dark flash while keeping IndexedDB authoritative for domain data.
- Route compatibility is protocol-specific. A user-configured Grok route was observed to fail with 404 on Responses while succeeding on Chat Completions, so each API Profile must preserve the selected protocol instead of assuming one relay-wide default.
- Web access is protocol-specific and turn-scoped: Responses sends `tools: [{ type: "web_search" }]`; Chat Completions sends `web_search_options: {}` only when the composer's current-turn web option is enabled.
- Real-device API success still depends on the gateway allowing browser CORS. If CORS is blocked, a static-only deployment cannot complete the request without a proxy.
- Web access is now wired as a composer-level temporary request option rather than a static model toggle. Multimodal intent is also kept in the composer as a current-turn placeholder; image/file content sending is still not wired into the request builder.

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
- API Key editing uses an app-owned persistent show/hide button instead of relying on browser-specific password-field eye icons.
- Debug mode exposes a manual **总结上下文** action and a **显示总结** preview. Summary generation calls the configured global context-summary utility assistant, applies the current chat assistant's context Profile, stores the generated active rolling summary on the conversation, and keeps the visible message thread unchanged except for a small debug status hint.
- Settings has explicit built-in feature references for **上下文总结助手** and **上下文压缩助手**. The utility kind only makes an assistant eligible; feature settings decide which utility assistant is used by each built-in operation.
- Settings exposes the fixed five-section context-summary framework. Users can override each section's system description, restore one section, or restore all default descriptions; section IDs and titles remain app-defined.
- Settings also exposes reusable **上下文 Profile** records. A chat assistant references one Profile; each Profile keeps the fixed five dimensions but can add per-dimension business/domain guidance, such as roleplay formatting rules, relationship/emotion tracking, random events, or task-specific exploration notes.
- Each Context Profile dimension has an explicit enable checkbox. Disabled dimensions stay visible and keep any previously edited text as local preview data, but they are greyed out, cannot be edited until re-enabled, and are excluded from regular chat injection and summary prompts.

## API Profile and model configuration

- `apiProfiles` are stored independently in `MobileChatDB`.
- Each API Profile owns:
  - display name and description;
  - `baseUrl`;
  - local `apiKey`;
  - protocol, currently `openai-responses` or `openai-chat-completions`;
  - editable model definitions.
- Each model owns:
  - model ID / slug;
  - display name;
  - description;
  - optional context window;
  - enabled flag.
- The API Profile editor shows the full model list as selectable model cards, so every model visible in assistant model access can be traced back to a model-side configuration record.
- Assistants own model bindings that reference existing API Profile + model records, with snapshots of key display fields for provenance. Chat assistants also reference a reusable context Profile; utility summary assistants remain global and read the active chat assistant's Profile at execution time.

## User-owned connection configuration

- The repo no longer seeds a concrete relay URL, API key, or model slug. First-run data contains a generic editable API Profile and model placeholder.
- User-specific routes and provider-specific model slugs should be created through the settings UI, import flow, or a local-only MobileChatDB update. Newly created API Profiles and models default optional descriptions to empty strings.
- API keys remain in the browser's IndexedDB unless the user exports with credentials in a future explicit flow.
- CRUD status: API Profiles, model definitions, assistants, context Profiles, active conversations, and archived conversations all expose create/read/update/delete flows in the UI. Deleting the last required runtime object creates a blank local fallback so the app remains operable.
- Conversation deletion uses a confirmation prompt before permanently removing the conversation and its owned messages.
- Single-message deletion uses a separate confirmation prompt. UI terminology distinguishes large conversation containers as "对话" and individual records inside a conversation as "消息".

## Persistence and import/export

- `MobileChatDB` stores settings, API profiles, assistants, reusable context Profiles, conversations, messages, and reserved stores for drafts/checkpoints/blobs.
- Messages now store `createdAt`, assistant `completedAt`, and assistant `elapsedMs` where available. They are rendered chronologically by creation time, while completed assistant responses show finish time and request duration.
- Conversations may store `contextSummaries[]` plus `activeContextSummaryId`. The current implementation still manages one active rolling summary, but each record already keeps kind, status, boundary message ID, covered message count, retained raw tail count, framework snapshot, context Profile snapshot, update time, and summary-assistant/model source snapshot.
- During rapid iteration, persistence accepts only the current MobileChatDB record shape. Older fields are not translated into current configuration; users may reconfigure local profiles/assistants if a breaking schema change lands before the stable version.
- UI edits update memory immediately and are autosaved after a short debounce. Settings close and page visibility changes flush the latest snapshot.
- Settings persist the selected theme and whether Responses streaming is enabled.
- The current implementation persists normalized full snapshots. This is acceptable for the current small prototype; future large histories should move to dirty-record writes as specified in the architecture document.
- `.mobilechat` archives contain `manifest.json`, `records.json`, and `checksums.json`.
- The current export path is credential-free: API Profile metadata and model definitions are exported, but `apiKey` is cleared.
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
- Image URL/file input should use generic MobileChat content parts locally, then serialize only when the current draft contains those parts and the active adapter/profile/model declares image-input support.
- Streaming can be requested by sending `stream: true`, but true incremental display still requires the gateway to flush SSE events. If the gateway returns JSON, MobileChat falls back to one-shot display.
- Enabling web access can legitimately increase response latency because the provider or relay may perform hosted search/tool execution before producing the final assistant text. Successful searched responses are therefore not treated as an implementation error solely because they are slower than non-search turns.
- Debug diagnostics fold current-turn options into the pre-send budget card, for example `模型名 · 联网 · 仅文本`, instead of rendering a separate transient-options card.
- When a valid `contextSummary` exists, the debug input estimate is based on the projected request (`contextSummary` plus raw tail) rather than the full visible message list.

## Verification

- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run test:browser`

Current automated coverage includes Desktop Chrome and Pixel-class Mobile Chrome projects.

## Remaining limitations

- No endpoint validation button yet.
- No model discovery (`GET /models`) UI yet; model list is manually edited.
- No real context compression/checkpoint execution yet.
- No credential-including export flow yet; current export deliberately removes API keys.
- No CORS workaround exists in the static deployment. If the selected relay rejects browser origins, a proxy route is required.
