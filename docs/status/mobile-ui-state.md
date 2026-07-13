# Mobile UI state

Date: 2026-07-13

## Current verified state

- The mobile/desktop shell is usable with persisted local state.
- Conversation creation, conversation selection, title edit, title/summary search, archive action, archived conversation view, draft input, send, stop, debug panel toggle, settings open/close, theme switch, streaming switch, assistant switch, and model switch are covered by automated tests.
- Settings is no longer a placeholder. It exposes persisted API Profile, model, assistant, backup, theme, and streaming controls.
- The app has OpenAI-compatible Responses and Chat Completions request loops. Responses sends `POST {baseUrl}/responses` using `store:false`; Chat Completions sends `POST {baseUrl}/chat/completions`. Without an API key it shows a local configuration error. Streaming mode uses SSE text deltas when the gateway truly streams; if a `stream:true` request is buffered into JSON, the client falls back to one-shot JSON parsing.
- Route compatibility is protocol-specific. A user-configured Grok route was observed to fail with 404 on Responses while succeeding on Chat Completions, so each API Profile must preserve the selected protocol instead of assuming one relay-wide default.
- Real-device API success still depends on the gateway allowing browser CORS. If CORS is blocked, a static-only deployment cannot complete the request without a proxy.
- Web access is now wired as a model-level request option. Multimodal input is still not wired into the MobileChat request builder and must be implemented as explicit adapter/profile/model capabilities rather than prompt-only expectations.

## Implemented response to mobile feedback

- Assistant selection uses a native `<select>` in the chat header.
- Model selection is a second native `<select>` and is limited to the currently selected assistant's allowed model bindings.
- The settings panel is full-screen on small screens and a wide details panel on desktop.
- The conversation drawer keeps the bottom archive/settings actions visible while the conversation list scrolls.
- The chat header provides a direct title edit entry. Press Enter or the check button to save; Esc or the close button cancels.
- Archived conversations now have a sidebar entry. The archived view searches only title and summary, allows browsing and restoring, and keeps the composer read-only until restore.
- Assistant messages expose a retry action; retry removes the selected assistant reply and later messages before regenerating with the current assistant/model. Messages also expose a local delete action.
- Dark mode styles native select options and applies `color-scheme: dark` to avoid white dropdown backgrounds with pale text.
- The assistant details panel is schema-rendered from `assistantFields`, so newly added assistants use the same reflected editor instead of a special hard-coded page.

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
- Assistants no longer own raw `apiProfileName` / `model` fields as the active configuration path. They own model bindings that reference existing API Profile + model records, with snapshots of key display fields for provenance.
- Legacy assistant records containing `apiProfileName` / `model` are migrated into model bindings on load/import.

## User-owned connection configuration

- The repo no longer seeds a concrete relay URL, API key, or model slug. First-run data contains a generic editable API Profile and model placeholder.
- User-specific routes, provider-specific model slugs, and web-search-enabled models should be created through the settings UI, import flow, or a local-only MobileChatDB update.
- API keys remain in the browser's IndexedDB unless the user exports with credentials in a future explicit flow.
- CRUD status: API Profiles, model definitions, assistants, active conversations, and archived conversations all expose create/read/update/delete flows in the UI. Deleting the last required runtime object creates a blank local fallback so the app remains operable.
- Conversation deletion uses a confirmation prompt before permanently removing the conversation and its owned messages.

## Persistence and import/export

- `MobileChatDB` stores settings, API profiles, assistants, conversations, messages, and reserved stores for drafts/checkpoints/blobs.
- Messages now store `createdAt` and are rendered chronologically. Legacy generated message IDs are migrated into timestamps where possible, preventing IndexedDB key ordering from grouping `assistant-*` records before `message-*` records after reload.
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
- Full provider usage is still stored on the assistant message record for future cost and budget panels.

## Web access and multimodal route flags

- For an OpenAI-compatible Responses route, web access requires an explicit tool configuration such as `tools: [{ "type": "web_search" }]`. MobileChat stores this as `ModelDefinition.webSearchEnabled` and sends the tool only when the active model enables it.
- Prompting “请联网查询” is not sufficient if the request does not declare a search tool or the selected model route does not support it.
- Image URL/file input should use generic MobileChat content parts locally, then serialize only when the active adapter/profile/model declares image-input support.
- Streaming can be requested by sending `stream: true`, but true incremental display still requires the gateway to flush SSE events. If the gateway returns JSON, MobileChat falls back to one-shot display.

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
