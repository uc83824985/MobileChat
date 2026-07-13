# Mobile UI state

Date: 2026-07-13

## Current verified state

- The mobile/desktop shell is usable with persisted local state.
- Conversation creation, conversation selection, title edit, title/summary search, archive action, draft input, send, stop, debug panel toggle, settings open/close, theme switch, streaming switch, assistant switch, and model switch are covered by Playwright.
- Settings is no longer a placeholder. It exposes persisted API Profile, model, assistant, backup, theme, and streaming controls.
- The app has a minimal OpenAI-compatible Responses request loop. Without an API key it shows a local configuration error; with an API key it sends `POST {baseUrl}/responses` using `store:false`. Streaming mode uses SSE text deltas; non-streaming mode still works as a fallback.
- Real-device API success still depends on the gateway allowing browser CORS. If CORS is blocked, a static-only deployment cannot complete the request without a proxy.

## Implemented response to mobile feedback

- Assistant selection uses a native `<select>` in the chat header.
- Model selection is a second native `<select>` and is limited to the currently selected assistant's allowed model bindings.
- The settings panel is full-screen on small screens and a wide details panel on desktop.
- The conversation drawer keeps the bottom archive/settings actions visible while the conversation list scrolls.
- The chat header provides a direct title edit entry. Press Enter or the check button to save; Esc or the close button cancels.
- Dark mode styles native select options and applies `color-scheme: dark` to avoid white dropdown backgrounds with pale text.
- The assistant details panel is schema-rendered from `assistantFields`, so newly added assistants use the same reflected editor instead of a special hard-coded page.

## API Profile and model configuration

- `apiProfiles` are stored independently in `MobileChatDB`.
- Each API Profile owns:
  - display name and description;
  - `baseUrl`;
  - local `apiKey`;
  - protocol, currently `openai-responses`;
  - editable model definitions.
- Each model owns:
  - model ID / slug;
  - display name;
  - description;
  - optional context window;
  - enabled flag.
- Assistants no longer own raw `apiProfileName` / `model` fields as the active configuration path. They own model bindings that reference existing API Profile + model records, with snapshots of key display fields for provenance.
- Legacy assistant records containing `apiProfileName` / `model` are migrated into model bindings on load/import.

## MNAPI preset

- The repo seeds a credential-free MNAPI profile:
  - `baseUrl`: `https://api.mnapi.com/v1`
  - protocol: `openai-responses`
  - default preset model: `gpt-5.4-codex-high`
- Preset model slugs include high/medium/low Codex variants plus generic `gpt-5.4` and `gpt-5.4-mini`.
- No API key from the local launcher is committed. The key must be entered in the settings page and remains in the browser's IndexedDB unless the user exports with credentials in a future explicit flow.

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
- The post-send usage display uses explicit labels:
  - `in`: provider-reported input tokens;
  - `out`: provider-reported output tokens;
  - `total`: provider-reported total tokens, or `in + out` fallback;
  - `cache cached/input`: cached input tokens divided by input tokens.
- A display such as `cache 0/95` means no cached input tokens were reported for 95 input tokens. It is not the total usage.

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
- No CORS workaround exists in the static deployment. If MNAPI rejects browser origins, a proxy route is required.
