## 1. Project and PWA foundation

- [x] 1.1 Scaffold a React, TypeScript, and Vite application with production and development scripts
- [x] 1.2 Configure formatting, linting, type checking, unit tests, component tests, and browser-test commands
- [x] 1.3 Add the mobile viewport shell, global styles, accessible theme tokens, and responsive navigation layout
- [x] 1.4 Add the web manifest, icons, service-worker generation, offline shell caching, and update notification behavior
- [x] 1.5 Configure repository-relative routing and a GitHub Actions workflow that builds and deploys to GitHub Pages

## Current implementation notes

- 2026-07-13: Implemented a first persistence/config/API slice that is intentionally narrower than several full tasks below: normalized full-snapshot `MobileChatDB` save/load, credential-free `.mobilechat` import/export, light/dark/system theme setting, editable API Profiles with nested model definitions, assistant model bindings, chat-page assistant/model selectors, direct title editing, and a settings-toggleable `store:false` Responses request loop with SSE text-delta streaming.
- 2026-07-13: Follow-up UI/API hardening added visible model-side cards for every configured model, archived-conversation browsing/search/restore, message retry/delete actions, cache-only post-send usage display, and JSON fallback when a `stream:true` relay returns a buffered non-SSE response.
- 2026-07-13: Added model-level `webSearchEnabled` and Responses `web_search` tool emission for models that enable web access. Concrete relay URLs, API keys, and model slugs remain user-owned configuration and are not seeded by the repository.
- 2026-07-13: Completed first-pass delete flows for API Profiles, assistants, active conversations, and archived conversations. Provider errors now include non-secret route diagnostics: request URL, model ID, and web-search switch state.
- 2026-07-13: Added an `openai-chat-completions` protocol option for relays/models that expose `/chat/completions` but not `/responses`; route diagnostics now include the selected protocol.
- 2026-07-13: Recorded route-specific compatibility finding: a user-configured Grok route succeeded through Chat Completions after returning 404 on Responses. Added the user-message "重答" action to regenerate the assistant response from a chosen user message.
- 2026-07-13: Added Chat Completions web-search serialization through `web_search_options: {}` and added confirmation for individual message deletion.
- 2026-07-13: Added persisted message timing metadata (`createdAt`, `completedAt`, `elapsedMs`) and clarified cache diagnostics when a relay returns input tokens but omits cached-token detail.
- 2026-07-13: Replaced the ambiguous "电脑端布局" toggle with a persisted layout mode: `auto`, `mobile`, or `desktop`. Layout changes apply immediately and remain display-only.
- 2026-07-14: Moved web search from model-level static configuration to a composer-level single-turn option, added a current-turn multimodal placeholder, and added mobile floating controls for opening the drawer and returning to the top of the message thread.
- 2026-07-14: Preserved message whitespace/long-token wrapping in the renderer and folded current-turn options into the pre-send diagnostics card.
- 2026-07-14: Added a persistent API-key reveal control, empty descriptions for newly created profiles/models, top/bottom floating scroll toggle behavior, and documented the minimal manual/threshold context-compaction path.
- 2026-07-14: Fixed the floating scroll control so manual scrolling to the message top or bottom also updates the next target.
- The full task checklist remains open where the spec still requires dirty-record repositories, endpoint validation, pricing metadata, utility roles, checkpoint execution, merge import, complete context projection, provider-specific hosted tool variants, multimodal content sending, and full streaming event/error coverage beyond the current text-delta path.

## 2. Domain model and local persistence

- [ ] 2.1 Define versioned TypeScript domain types for API profiles, models, model pricing metadata, chat/utility assistants, bindings, conversations, messages, content parts, blobs, drafts, context checkpoints, display summaries, context budget reports, pre-send cache estimates, normalized usage stats, and settings
- [ ] 2.2 Create the `MobileChatDB` IndexedDB database schema, including immutable context-checkpoint storage, typed repository interfaces, transactions, and store indexes
- [ ] 2.3 Implement schema-version metadata and an ordered migration runner with rollback-safe failure handling
- [ ] 2.4 Implement ID, timestamp, validation, and reference-resolution utilities shared by repositories and imports
- [ ] 2.5 Implement conversation and message source-snapshot creation that excludes credentials and remains readable without live configuration
- [ ] 2.6 Add repository tests for persistence, cascading conversation deletion, unresolved references, and migration failure recovery
- [ ] 2.7 Implement non-blocking autosave with dirty-record writes, save-status reporting, debounced text flushes, storage persistence requests, and quota/status diagnostics

## 3. API profiles and assistant configuration

- [ ] 3.1 Implement API-profile create, edit, enable, disable, and delete operations with nested model definitions
- [ ] 3.2 Implement assistant create, edit, enable, disable, and delete operations with chat/utility kinds, utility roles, nested model bindings, and default-binding enforcement
- [ ] 3.3 Implement binding resolution and invalid-reference reporting without deleting historical or disabled configuration
- [ ] 3.4 Build the settings pages for API-profile details, model lists, optional context-window and pricing metadata, assistant kind/utility role, identity, prompt, initial message, and model bindings
- [ ] 3.5 Add credential, endpoint, protocol, model-parameter, avatar, and prompt form validation with recoverable validation messages
- [ ] 3.6 Build reusable active-chat-assistant and model-binding selectors for conversation creation and mid-conversation switching while excluding utility assistants from speaker selection

## 4. Responses API adapter

- [ ] 4.1 Define the protocol-adapter contract, normalized request/event types, content capabilities, and adapter registry
- [ ] 4.2 Implement the initial OpenAI-compatible Responses API request builder using direct browser fetch, the local conversation context projection, current instructions, dynamic title/checkpoint metadata, `stream: true`, and `store: false`
- [ ] 4.3 Implement robust SSE parsing and normalized text-delta, completion, refusal, interruption, and error events
- [ ] 4.4 Implement abort handling and ensure cancellation closes the stream and produces a persistent interrupted response state
- [ ] 4.5 Implement API-profile/model connection testing with differentiated CORS, authentication, endpoint, protocol, and model-route diagnostics
- [ ] 4.6 Normalize provider usage fields for input, output, total, cached input, cache writes, reasoning tokens, and raw provider usage when returned
- [ ] 4.7 Ensure provider response IDs, provider conversation IDs, and continuation-looking fields are retained only as diagnostics and never used for first-release context construction
- [ ] 4.8 Add adapter tests for fragmented SSE frames, unknown events, terminal errors, aborts, local stateless request construction, missing usage fields, cache-metric normalization, and ignored continuation fields
- [ ] 4.9 Add explicit provider capability settings for hosted web search, image/file input, and other tools; ensure the request builder sends only capabilities supported by the selected protocol/profile/model and reports unsupported combinations before sending

## 5. Conversation and message experience

- [ ] 5.1 Implement conversation create, open, continue, rename, active-selection update, archive, unarchive, and confirmed permanent deletion services
- [x] 5.2 Build the active conversation screen, mobile conversation drawer, archived view, and empty/new-conversation states
- [ ] 5.3 Render ordered user and assistant messages with role labels, timestamps, content parts, and per-response assistant/model snapshots
- [ ] 5.4 Implement draft persistence, send validation, optimistic user-message persistence, streamed assistant persistence, and terminal statuses
- [ ] 5.5 Implement deterministic same-conversation context projection from the current chat prompt, latest valid checkpoint, and raw active-path tail after assistant switches
- [ ] 5.6 Implement request-time conversation metadata construction that reads the latest title and checkpoint without adding or rewriting chat messages
- [ ] 5.7 Implement local deterministic algorithmic-anchor selection for pinned or keyword-matched original message spans without model rewriting
- [ ] 5.8 Generate a context budget report for every request with estimated tokens and percentages by section and origin plus a pre-send cache estimate with prefix fingerprint, potential cacheable rate, estimated hit rate, confidence, and instability reasons
- [ ] 5.9 Implement assistant initial-message behavior and snapshot attribution for newly created conversations
- [ ] 5.10 Implement copy, retry, stop, regenerate, user-message edit, branch creation, and active-path selection actions
- [ ] 5.11 Handle missing/deleted active assistants or models by retaining history and requiring a valid replacement before sending
- [ ] 5.12 Invalidate checkpoints whose covered boundary is not an ancestor of the selected active leaf and rebuild from local canonical messages

## 6. Search, titles, and context compaction

- [ ] 6.1 Implement Unicode-aware search normalization and a replaceable local fuzzy-search service
- [ ] 6.2 Build current-conversation content search with result count, highlighting, previous/next navigation, and scroll-to-message behavior
- [ ] 6.3 Build historical fuzzy search indexed only by conversation title and display summary, with matching excerpts and no historical message-body or context-summary scan
- [ ] 6.4 Add user-editable conversation title controls and keep list, header, export, and search indexes synchronized
- [ ] 6.5 Implement global compaction settings and per-conversation overrides for utility-assistant reference, minimum turns, turn interval, optional estimated-token threshold, retained raw turns, and output limits
- [ ] 6.6 Implement completed-turn and projected-input accounting plus foreground automatic compaction after qualifying assistant responses
- [ ] 6.7 Implement incremental utility-assistant compaction from a previous checkpoint and post-boundary messages, producing validated context and display summaries in one call
- [ ] 6.8 Implement immutable checkpoint creation with assistant/model snapshots, atomic active-checkpoint updates, and active-path validity checks
- [ ] 6.9 Add a manual **Compact context** action, progress indicators, retryable failures, and isolation from completed chat responses
- [ ] 6.10 Add context-limit warnings that require compaction or a model/context change rather than silently dropping messages
- [ ] 6.11 Add tests proving history search ignores message bodies, compaction triggers only at configured boundaries, utility output stays outside chat, and no cross-conversation data enters a checkpoint

## 7. Extensible contents and mobile preview

- [ ] 7.1 Implement ordered versioned content parts, blob records, content renderers, and searchable-text extraction
- [ ] 7.2 Implement browser file selection, metadata capture, quota-aware blob persistence, and object-URL lifecycle management
- [ ] 7.3 Build draft and persisted previews for text files and browser-decodable images, including denied/read-failure states
- [ ] 7.4 Enforce adapter content capabilities so unsupported parts are never silently omitted from a request
- [ ] 7.5 Add feature detection and an isolated experimental interface for writable mobile file handles without making it a core dependency

## 8. Backup, restore, and data resilience

- [ ] 8.1 Define and document the ZIP-compatible `.mobilechat` archive layout, manifest version, record schema, checksums, and reference-integrity rules
- [ ] 8.2 Implement complete local export for configuration, optional credentials, assistants, conversations, messages, checkpoints, settings, and binary blob entries
- [ ] 8.3 Implement archive-size estimation, attachment selection, credential inclusion confirmation, and last-successful-export tracking
- [ ] 8.4 Implement isolated ZIP parsing with entry-path safety, checksum verification, schema migration, validation, and an import-summary preview before local mutation
- [ ] 8.5 Implement transactional replace import and ID-remapped merge import with complete internal reference rewriting
- [ ] 8.6 Add storage quota, transaction failure, corrupt archive, checksum mismatch, unsupported version, and browser eviction guidance to user-facing error flows
- [ ] 8.7 Add cross-browser round-trip, merge-conflict, invalid-archive, credential-free, blob-integrity, and failed-replacement tests that prove existing data is preserved on failure

## 9. End-to-end verification and documentation

- [ ] 9.1 Add component tests for settings CRUD, assistant kinds, assistant/model switching, dynamic title/checkpoint awareness, conversation management, message actions, search, and compaction states
- [ ] 9.2 Add component tests for debug mode, context budget display, pre-send cache estimates, normalized usage display, cache unknown states, and credential redaction
- [ ] 9.3 Add phone-viewport browser tests for first-run configuration, streaming chat, relaunch persistence, manual compact, diagnostics panel, archive/restore, and `.mobilechat` backup restore
- [ ] 9.4 Verify keyboard, screen-reader labels, focus handling, reduced motion, touch targets, drawers, dialogs, and streaming announcements
- [ ] 9.5 Verify installability, offline reading, service-worker updates, IndexedDB persistence, and local content preview on supported desktop and mobile browsers
- [ ] 9.6 Perform a real direct-endpoint smoke test for Responses streaming, usage fields, cache metric availability, and local stateless context behavior, documenting relay-specific compatibility observations separately from model-route failures
- [ ] 9.7 Write README instructions for local development, GitHub Pages deployment, first-run API configuration, same-conversation memory and compaction, debug diagnostics, `.mobilechat` cross-device migration, supported protocol, and known mobile file limitations
