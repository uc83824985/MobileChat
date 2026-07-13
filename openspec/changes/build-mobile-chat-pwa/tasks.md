## 1. Project and PWA foundation

- [ ] 1.1 Scaffold a React, TypeScript, and Vite application with production and development scripts
- [ ] 1.2 Configure formatting, linting, type checking, unit tests, component tests, and browser-test commands
- [ ] 1.3 Add the mobile viewport shell, global styles, accessible theme tokens, and responsive navigation layout
- [ ] 1.4 Add the web manifest, icons, service-worker generation, offline shell caching, and update notification behavior
- [ ] 1.5 Configure repository-relative routing and a GitHub Actions workflow that builds and deploys to GitHub Pages

## 2. Domain model and local persistence

- [ ] 2.1 Define versioned TypeScript domain types for API profiles, models, assistants, bindings, conversations, messages, content parts, blobs, drafts, summaries, and settings
- [ ] 2.2 Create the IndexedDB database schema, typed repository interfaces, transactions, and store indexes
- [ ] 2.3 Implement schema-version metadata and an ordered migration runner with rollback-safe failure handling
- [ ] 2.4 Implement ID, timestamp, validation, and reference-resolution utilities shared by repositories and imports
- [ ] 2.5 Implement conversation and message source-snapshot creation that excludes credentials and remains readable without live configuration
- [ ] 2.6 Add repository tests for persistence, cascading conversation deletion, unresolved references, and migration failure recovery

## 3. API profiles and assistant configuration

- [ ] 3.1 Implement API-profile create, edit, enable, disable, and delete operations with nested model definitions
- [ ] 3.2 Implement assistant create, edit, enable, disable, and delete operations with nested model bindings and default-binding enforcement
- [ ] 3.3 Implement binding resolution and invalid-reference reporting without deleting historical or disabled configuration
- [ ] 3.4 Build the settings pages for API-profile details, model lists, assistant identity, prompt, initial message, and model bindings
- [ ] 3.5 Add credential, endpoint, protocol, model-parameter, avatar, and prompt form validation with recoverable validation messages
- [ ] 3.6 Build reusable active-assistant and model-binding selectors for conversation creation and mid-conversation switching

## 4. Responses API adapter

- [ ] 4.1 Define the protocol-adapter contract, normalized request/event types, content capabilities, and adapter registry
- [ ] 4.2 Implement the initial OpenAI-compatible Responses API request builder using direct browser fetch, full context, current instructions, dynamic title/summary metadata, `stream: true`, and `store: false`
- [ ] 4.3 Implement robust SSE parsing and normalized text-delta, completion, refusal, interruption, and error events
- [ ] 4.4 Implement abort handling and ensure cancellation closes the stream and produces a persistent interrupted response state
- [ ] 4.5 Implement API-profile/model connection testing with differentiated CORS, authentication, endpoint, and protocol diagnostics
- [ ] 4.6 Add adapter tests for fragmented SSE frames, unknown events, terminal errors, aborts, and stateless request construction

## 5. Conversation and message experience

- [ ] 5.1 Implement conversation create, open, continue, rename, active-selection update, archive, unarchive, and confirmed permanent deletion services
- [ ] 5.2 Build the active conversation screen, mobile conversation drawer, archived view, and empty/new-conversation states
- [ ] 5.3 Render ordered user and assistant messages with role labels, timestamps, content parts, and per-response assistant/model snapshots
- [ ] 5.4 Implement draft persistence, send validation, optimistic user-message persistence, streamed assistant persistence, and terminal statuses
- [ ] 5.5 Implement shared-context construction that applies only the current assistant system prompt after assistant switches
- [ ] 5.6 Implement request-time conversation metadata construction that reads the latest title and summary without adding or rewriting chat messages
- [ ] 5.7 Implement assistant initial-message behavior and snapshot attribution for newly created conversations
- [ ] 5.8 Implement copy, retry, stop, regenerate, user-message edit, branch creation, and active-path selection actions
- [ ] 5.9 Handle missing/deleted active assistants or models by retaining history and requiring a valid replacement before sending

## 6. Search, titles, and summaries

- [ ] 6.1 Implement Unicode-aware search normalization and a replaceable local fuzzy-search service
- [ ] 6.2 Build current-conversation content search with result count, highlighting, previous/next navigation, and scroll-to-message behavior
- [ ] 6.3 Build historical fuzzy search indexed only by conversation title and summary, with matching excerpts and no historical message-body scan
- [ ] 6.4 Add user-editable conversation title controls and keep list, header, export, and search indexes synchronized
- [ ] 6.5 Implement global summary settings and per-conversation overrides for enablement, minimum turns, interval, model reference, prompt, and maximum length
- [ ] 6.6 Implement completed-turn accounting and foreground automatic summary triggering after qualifying assistant responses
- [ ] 6.7 Implement incremental summary requests using the previous summary and post-boundary messages, plus atomic boundary updates
- [ ] 6.8 Add manual summary refresh, progress indicators, retryable failures, and isolation from completed chat responses
- [ ] 6.9 Add tests proving that history search ignores message bodies and summaries trigger only at configured completed-turn boundaries

## 7. Extensible contents and mobile preview

- [ ] 7.1 Implement ordered versioned content parts, blob records, content renderers, and searchable-text extraction
- [ ] 7.2 Implement browser file selection, metadata capture, quota-aware blob persistence, and object-URL lifecycle management
- [ ] 7.3 Build draft and persisted previews for text files and browser-decodable images, including denied/read-failure states
- [ ] 7.4 Enforce adapter content capabilities so unsupported parts are never silently omitted from a request
- [ ] 7.5 Add feature detection and an isolated experimental interface for writable mobile file handles without making it a core dependency

## 8. Backup, restore, and data resilience

- [ ] 8.1 Define and document the versioned JSON backup format and reference-integrity validation rules
- [ ] 8.2 Implement complete local export for configuration, assistants, conversations, messages, summaries, settings, and selected encoded blobs
- [ ] 8.3 Implement isolated import parsing, schema migration, validation, and an import-summary preview before local mutation
- [ ] 8.4 Implement transactional replace import and ID-remapped merge import with internal reference rewriting
- [ ] 8.5 Add storage quota, transaction failure, corrupt data, unsupported version, and browser eviction guidance to user-facing error flows
- [ ] 8.6 Add round-trip, merge-conflict, invalid-backup, and failed-replacement tests that prove existing data is preserved on failure

## 9. End-to-end verification and documentation

- [ ] 9.1 Add component tests for settings CRUD, assistant/model switching, dynamic title/summary awareness, conversation management, message actions, search, and summary states
- [ ] 9.2 Add phone-viewport browser tests for first-run configuration, streaming chat, relaunch persistence, archive/restore, and backup restore
- [ ] 9.3 Verify keyboard, screen-reader labels, focus handling, reduced motion, touch targets, drawers, dialogs, and streaming announcements
- [ ] 9.4 Verify installability, offline reading, service-worker updates, IndexedDB persistence, and local content preview on supported desktop and mobile browsers
- [ ] 9.5 Perform a real direct-endpoint smoke test for Responses streaming and document any relay-specific compatibility observations
- [ ] 9.6 Write README instructions for local development, GitHub Pages deployment, first-run API configuration, backup practices, supported protocol, and known mobile file limitations
