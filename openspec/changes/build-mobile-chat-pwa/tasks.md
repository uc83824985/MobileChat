## 1. Project and PWA foundation

- [ ] 1.1 Scaffold a React, TypeScript, and Vite application with production and development scripts
- [ ] 1.2 Configure formatting, linting, type checking, unit tests, component tests, and browser-test commands
- [ ] 1.3 Add the mobile viewport shell, global styles, accessible theme tokens, and responsive navigation layout
- [ ] 1.4 Add the web manifest, icons, service-worker generation, offline shell caching, and update notification behavior
- [ ] 1.5 Configure repository-relative routing and a GitHub Actions workflow that builds and deploys to GitHub Pages

## 2. Domain model and local persistence

- [ ] 2.1 Define versioned TypeScript domain types for API profiles, models, chat/utility assistants, bindings, conversations, messages, content parts, blobs, drafts, context checkpoints, display summaries, and settings
- [ ] 2.2 Create the IndexedDB database schema, including immutable context-checkpoint storage, typed repository interfaces, transactions, and store indexes
- [ ] 2.3 Implement schema-version metadata and an ordered migration runner with rollback-safe failure handling
- [ ] 2.4 Implement ID, timestamp, validation, and reference-resolution utilities shared by repositories and imports
- [ ] 2.5 Implement conversation and message source-snapshot creation that excludes credentials and remains readable without live configuration
- [ ] 2.6 Add repository tests for persistence, cascading conversation deletion, unresolved references, and migration failure recovery

## 3. API profiles and assistant configuration

- [ ] 3.1 Implement API-profile create, edit, enable, disable, and delete operations with nested model definitions
- [ ] 3.2 Implement assistant create, edit, enable, disable, and delete operations with chat/utility kinds, utility roles, nested model bindings, and default-binding enforcement
- [ ] 3.3 Implement binding resolution and invalid-reference reporting without deleting historical or disabled configuration
- [ ] 3.4 Build the settings pages for API-profile details, model lists, assistant kind/utility role, identity, prompt, initial message, and model bindings
- [ ] 3.5 Add credential, endpoint, protocol, model-parameter, avatar, and prompt form validation with recoverable validation messages
- [ ] 3.6 Build reusable active-chat-assistant and model-binding selectors for conversation creation and mid-conversation switching while excluding utility assistants from speaker selection

## 4. Responses API adapter

- [ ] 4.1 Define the protocol-adapter contract, normalized request/event types, content capabilities, and adapter registry
- [ ] 4.2 Implement the initial OpenAI-compatible Responses API request builder using direct browser fetch, the local conversation context projection, current instructions, dynamic title/checkpoint metadata, `stream: true`, and `store: false`
- [ ] 4.3 Implement robust SSE parsing and normalized text-delta, completion, refusal, interruption, and error events
- [ ] 4.4 Implement abort handling and ensure cancellation closes the stream and produces a persistent interrupted response state
- [ ] 4.5 Implement API-profile/model connection testing with differentiated CORS, authentication, endpoint, protocol, and model-route diagnostics
- [ ] 4.6 Add an optional provider-continuation capability probe that verifies unique-marker recall and does not treat accepted parameters or returned IDs alone as support
- [ ] 4.7 Add adapter tests for fragmented SSE frames, unknown events, terminal errors, aborts, local stateless request construction, and false-positive continuation probes

## 5. Conversation and message experience

- [ ] 5.1 Implement conversation create, open, continue, rename, active-selection update, archive, unarchive, and confirmed permanent deletion services
- [ ] 5.2 Build the active conversation screen, mobile conversation drawer, archived view, and empty/new-conversation states
- [ ] 5.3 Render ordered user and assistant messages with role labels, timestamps, content parts, and per-response assistant/model snapshots
- [ ] 5.4 Implement draft persistence, send validation, optimistic user-message persistence, streamed assistant persistence, and terminal statuses
- [ ] 5.5 Implement deterministic same-conversation context projection from the current chat prompt, latest valid checkpoint, and raw active-path tail after assistant switches
- [ ] 5.6 Implement request-time conversation metadata construction that reads the latest title and checkpoint without adding or rewriting chat messages
- [ ] 5.7 Implement assistant initial-message behavior and snapshot attribution for newly created conversations
- [ ] 5.8 Implement copy, retry, stop, regenerate, user-message edit, branch creation, and active-path selection actions
- [ ] 5.9 Handle missing/deleted active assistants or models by retaining history and requiring a valid replacement before sending
- [ ] 5.10 Invalidate checkpoints whose covered boundary is not an ancestor of the selected active leaf and rebuild from local canonical messages

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
- [ ] 9.2 Add phone-viewport browser tests for first-run configuration, streaming chat, relaunch persistence, manual compact, archive/restore, and `.mobilechat` backup restore
- [ ] 9.3 Verify keyboard, screen-reader labels, focus handling, reduced motion, touch targets, drawers, dialogs, and streaming announcements
- [ ] 9.4 Verify installability, offline reading, service-worker updates, IndexedDB persistence, and local content preview on supported desktop and mobile browsers
- [ ] 9.5 Perform a real direct-endpoint smoke test for Responses streaming and semantic provider-continuation support, documenting relay-specific compatibility observations separately from model-route failures
- [ ] 9.6 Write README instructions for local development, GitHub Pages deployment, first-run API configuration, same-conversation memory and compaction, `.mobilechat` cross-device migration, supported protocol, and known mobile file limitations
