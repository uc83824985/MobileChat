## Context

MobileChat starts from an empty repository and targets personal use on modern mobile browsers. It must be deployable as static assets, call user-configured model endpoints directly, persist all application data locally, and remain structurally independent from any particular relay, assistant, or future message modality.

The initial endpoint already known to work exposes an OpenAI-compatible Responses API with browser CORS support, but the data model and protocol boundary must not assume that one endpoint forever. Mobile file write permissions are inconsistent across browsers, so content preview is required while source-file editing remains capability-gated and experimental.

The default layout is responsive and mobile-first at narrow viewport widths: the conversation list becomes a drawer and settings/detail grids collapse without changing application logic. A persisted `layoutMode` display setting supports `auto`, `mobile`, and `desktop`: `auto` follows viewport width, `mobile` forces drawer/single-column layout, and `desktop` forces the desktop layout structure. This flag is visual only; it must not affect local data shape, active conversation selection, context construction, or provider request payloads. Phone layouts may provide floating controls for opening the drawer and returning to the message top so long conversations do not require manual scrolling back to the header for navigation.

## Goals / Non-Goals

**Goals:**

- Deliver an installable mobile-first PWA requiring no application backend.
- Support reusable API profiles with multiple models and assistants that reference those models.
- Separate user-facing chat assistants from utility assistants used for semantic derived-data tasks such as context compression.
- Preserve conversations through assistant, prompt, model, and credential changes.
- Allow assistant/model switching inside a shared conversation context with accurate per-response attribution.
- Preserve robust memory within each conversation using local canonical messages and compacted context checkpoints, independently of provider-side response storage.
- Provide local conversation management, metadata-only history search, in-conversation content search, and configurable context compaction.
- Expose optional debug diagnostics for context composition, token budget estimates, provider usage, and cache metrics.
- Establish versioned content-part and persistence schemas suitable for later multimodal expansion.
- Deploy repeatably to GitHub Pages from this repository.

**Non-Goals:**

- User accounts, cloud synchronization, collaborative sharing, or a remote application database.
- Cross-conversation user memory, assistant memory, preference extraction, or retrieval from other conversations.
- A general-purpose proxy or protection of API keys from the local device user.
- Native Anthropic, Gemini, or other non-OpenAI-compatible protocol adapters in the first release.
- Reliable background jobs while the PWA is closed.
- Guaranteed editing or write-back of phone files.
- Full-text search across messages in historical conversations.

## Decisions

### 1. React, TypeScript, and Vite static application

Use React with TypeScript and Vite to build a fully static single-page application. Add a manifest and generated service worker through a PWA build integration, and configure the router and asset base for the `/MobileChat/` GitHub Pages path.

This provides a small, conventional frontend toolchain with compile-time data model checks and no server runtime. A single hand-authored HTML file was considered, but rejected because the required IndexedDB migrations, multiple settings surfaces, streaming lifecycle, and testable state transitions would become difficult to maintain.

### 2. `MobileChatDB` IndexedDB repository layer with explicit migrations

Use a single IndexedDB database named `MobileChatDB` behind a typed repository boundary. A small IndexedDB helper library may manage transactions and schema upgrades, but domain code must not expose library-specific record types. UI preferences that are safe to lose may use `localStorage`; domain records do not.

Primary stores:

```text
meta
settings
apiProfiles
assistants
conversations
messages
drafts
contextCheckpoints
blobs
```

Every record uses a stable application-generated ID, ISO timestamp fields, and an explicit record version. Database upgrades run ordered migrations inside transactions where the browser permits them. Exported backups carry an independent export schema version.

Writes are optimistic from the UI point of view: React state updates first, then a repository write commits the changed dirty record asynchronously. Selects, checkboxes, add/delete actions, message creation, checkpoint switching, import replacement, and archive/delete operations commit immediately, using transactions when consistency spans records. Text fields debounce commits for 300–500ms and flush on blur, settings close, send, and page visibility changes. The implementation must not serialize the whole database for every keystroke, block render on IndexedDB, or use synchronous `localStorage` for domain records. If real-device testing shows prompt editing jank on low-end phones, individual large text fields may switch to blur/manual save, but the default is non-blocking autosave.

After first meaningful configuration, request persistent storage with `navigator.storage.persist()` when available and show storage mode plus `navigator.storage.estimate()` usage/quota in settings or debug diagnostics. Persistent storage reduces eviction risk but does not replace `.mobilechat` backups because users can still clear site data, uninstall browsers, change origins, or lose devices.

### 3. API profiles aggregate models

Do not persist separate Connection and ModelRoute entities. An `ApiProfile` owns the endpoint, API key, protocol, and its model definitions:

```ts
type ApiProfile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  protocol: "openai-responses" | "openai-chat-completions";
  enabled: boolean;
  models: ModelDefinition[];
};
```

If two models need different credentials, headers, URLs, or protocols, they belong to different API profiles. Updating a credential updates every assistant binding that references it.

Each model definition may include optional context-window metadata and pricing categories for uncached input, cached input, cache writes, output, and reasoning tokens. These values are user-maintained estimates used only for local budget display; they are not required to send chat requests.

### 4. Assistants aggregate model bindings

Do not persist a standalone AssistantRoute entity. An `Assistant` owns identity and prompt data plus model references. Its kind also determines whether it can speak in the visible conversation or only perform a semantic utility operation:

```ts
type Assistant = {
  id: string;
  kind: "chat" | "utility";
  utilityRole?: "context-compression" | "content-analysis";
  name: string;
  description: string;
  avatar: AvatarValue;
  systemPrompt: string;
  initialMessage?: MessageContentPart[];
  enabled: boolean;
  modelBindings: Array<{
    apiProfileId: string;
    modelId: string;
    label?: string;
    parameterOverrides?: GenerationParameters;
    isDefault: boolean;
  }>;
};
```

The many-to-many assistant/model relationship is expressed by `modelBindings`. Runtime code resolves a binding against its API profile and model; unresolved bindings remain visible as invalid configuration instead of being silently removed.

Only enabled `chat` assistants are selectable as the active conversation speaker. A context-compaction policy references an enabled `utility` assistant whose `utilityRole` is `context-compression`. Utility results are stored as derived records and never inserted into the visible chat stream as assistant messages.

### 5. Generic conversations plus immutable source snapshots

A conversation stores the assistant/model selection intended for the next response and a snapshot for display if the referenced configuration disappears. Each assistant message independently records the actual source used for that response.

```text
Conversation
  activeAssistantId
  activeModelRef { apiProfileId, modelId }
  activeSourceSnapshot
  title
  displaySummary
  contextCheckpointId
  contextState
  status

Assistant Message
  assistantId
  modelRef
  sourceSnapshot
    assistantName, description, avatar, systemPrompt
    modelId, modelName, effectiveParameters
```

Snapshots never include API keys. The message snapshot is immutable after the response begins. This intentionally duplicates small identity and prompt fields so assistant deletion or later editing cannot erase historical attribution or the generation context.

### 6. Local single-conversation memory and current-assistant instructions

Canonical conversation memory consists of locally persisted messages on the active path. The model has no durable memory of a prior browser request, and provider response IDs are neither portable across profiles nor reliable across compatible relays. The local database is therefore the source of truth. Returned provider IDs may be retained as diagnostics, but they are not part of the first-release context mechanism.

For every chat request, the request builder produces a deterministic `ConversationContextProjection` in this order:

```text
current chat assistant prompt
current conversation metadata, including the latest title
latest valid context checkpoint summary
optional locally selected algorithmic anchors
raw active-path messages after the checkpoint boundary
latest user message
```

The context checkpoint replaces the covered older messages in the model input; it is not appended in addition to the full covered history. Covered messages remain in IndexedDB and remain visible, searchable inside the open conversation, exportable, and available for rebuilding a checkpoint. Optional algorithmic anchors are deterministic local selections of existing message spans, such as pinned messages or keyword matches, and include source message IDs; they are not model-generated rewrites. Only the currently selected chat assistant's system prompt is applied. Earlier assistants' visible messages remain ordinary shared context, while their old system prompts are not replayed.

The latest title and checkpoint summary are serialized as clearly delimited application-owned context, not executable instructions. The title is deliberately kept outside the checkpoint, so renaming a conversation updates the next request without invalidating or regenerating the checkpoint. Empty fields are omitted, and no synthetic synchronization message is persisted.

Messages include `parentMessageId` and the conversation records the active leaf. Edit-and-resubmit, regeneration, or active-branch changes invalidate a checkpoint when its covered boundary is not an ancestor of the new active leaf. Invalid checkpoints remain auditable but are not used; the application rebuilds from the active raw path until compaction succeeds. No context is silently borrowed from another conversation.

Each projection also produces a `ContextBudgetReport` before network send. It records estimated tokens and percentages by section and origin, including chat assistant prompt, application metadata, utility-assistant checkpoint summary, algorithmic anchors, user raw messages, assistant raw messages, and latest user input. It also records a `PreSendCacheEstimate` with the cache scope, stable prefix fingerprint, estimated input tokens, cacheable prefix tokens, potential cacheable rate, estimated cache-read hit rate, confidence, and prefix-instability reasons. Estimates are used for local budget decisions and debug display; provider usage returned after the response is stored separately as observed data.

### 7. Protocol adapter boundary with one initial implementation

Define a small adapter contract around validation, capability declaration, connection testing, request construction, streaming event normalization, and cancellation:

```ts
interface ChatProtocolAdapter {
  id: string;
  capabilities: ContentCapabilities;
  test(config: ResolvedModel): Promise<TestResult>;
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
}
```

Implement `openai-responses` and `openai-chat-completions` initially. Responses sends the local context projection, the current assistant instructions, `stream`, and `store: false`, then normalizes output-text deltas, completion, refusal, error events, and usage events when present. Chat Completions maps the assistant prompt to a `system` message and sends the local conversation as `messages` to `POST /chat/completions`. Provider-specific events not understood by the adapter are ignored only when they do not contain user-visible output, terminal errors, or usage data.

Hosted web search is serialized per protocol from a per-turn composer option, not from a static model flag. For Responses, enabling web access on the current send emits `tools: [{ type: "web_search" }]`. For Chat Completions, enabling web access on the current send emits `web_search_options: {}` and relies on a search-capable route/model on the provider side. Chat Completions search has fewer controls than Responses search, so advanced controls such as live-access flags, domain filters, complete source lists, and returned-token budgets remain Responses-only until separately modeled. Search-enabled turns may be materially slower than ordinary turns because hosted tool execution and relay/provider routing happen before or during text generation. After the send is queued, the composer option resets to the default non-web state.

Hosted provider tools are not inferred from prompt text. Web access is represented as an explicit per-turn request option. For an OpenAI-compatible Responses route this means adding an adapter-owned tool entry such as `tools: [{ type: "web_search" }]` only when enabled for the current send. If the gateway exposes a different flag, the API Profile or adapter definition must describe that provider-specific request shape. Returned search calls, opened-page diagnostics, and citations are display/debug data; they do not replace local conversation memory.

Streaming support is also observed at the adapter boundary. The UI may request `stream: true`, but a relay can still buffer and return one JSON response. In that case the adapter parses the completed JSON response and records that true SSE deltas were not observed, because the browser client cannot force incremental rendering if the gateway does not flush SSE chunks.

The first release does not use provider continuation modes such as `previous_response_id` or provider conversation IDs. The adapter contract may preserve raw diagnostic fields for future analysis, but conversation correctness, resume, export, import, branch changes, assistant switching, and context compaction all use local records only.

The adapter normalizes provider usage into a `UsageStats` shape when available:

```text
inputTokens
outputTokens
totalTokens
cachedInputTokens
cacheWriteTokens
reasoningTokens
rawProviderUsage
```

Cache read hit rate is calculated only after a response completes or emits final usage and the denominator is greater than zero: `cachedInputTokens / inputTokens`. Rolling conversation cache hit rate uses `sum(cachedInputTokens) / sum(inputTokens)` over the selected message range. Cache write ratio uses `cacheWriteTokens / inputTokens` when the provider reports write tokens and input tokens. If the endpoint returns input tokens but omits cached-token details, the UI may display the known denominator, for example `cache 未返回/N`, but the hit rate remains unsupported/unknown instead of being inferred as zero. If the endpoint omits usage or cache fields, the metric is marked unsupported or unknown instead of inferred from the local estimate.

Compatibility observation from 2026-07-13: one tested OpenAI-compatible relay returned 200 for a baseline Responses request and also accepted `store: true` plus `previous_response_id`. However, retrieving the created Response returned 404 and the chained request did not recall a unique marker from the stored response. MobileChat therefore treats provider state chaining on compatible relays as unsupported unless a route-specific probe proves otherwise. A later route-specific test found that a user-configured Grok route returned 404 on `POST /responses` while succeeding through `POST /chat/completions`, so protocol is part of user-owned route configuration rather than a global relay property. Concrete relay URLs and model slugs are user-owned configuration and are not seeded by the repository.

### 8. Typed content parts and separate blob records

Messages use ordered `contents` rather than a single provider payload. Initial part types include text plus metadata-bearing local image/file references. Binary data is stored once in a `blobs` store and referenced by content parts; previews use temporary object URLs.

The initial protocol adapter guarantees text. Multimodal intent belongs to the current draft/turn, not to a static model toggle. A draft containing non-text parts can be previewed and persisted, but can be sent only when the active adapter declares support for those part types. For OpenAI-compatible image input this is expected to serialize as image content parts such as image URLs or uploaded/base64 image data, depending on the provider and gateway. This prevents accidental omission. Backup export stores selected blob records as archive entries instead of embedding large binary payloads in JSON.

Writable file handles are never required by the domain model. If a supported browser grants a persistent writable handle, it is stored as optional capability metadata and accessed behind an experimental feature flag.

### 9. Separate current and historical search indexes

Current-conversation search derives an in-memory fuzzy index from searchable text content parts for the active conversation. Historical search maintains a lightweight index containing only conversation ID, title, and `displaySummary`. Historical message bodies and context checkpoint details are never loaded or searched for global history queries.

Search normalization handles Unicode case folding, whitespace, and punctuation consistently. A bundled fuzzy matcher may be used, but its scoring and highlighting are wrapped behind an application search service so the library can be replaced.

### 10. Utility-assistant context compaction inspired by `/compact`

A completed turn is a user message followed by a terminal assistant message status. Global compaction defaults may be overridden per conversation and include enablement, a context-compression utility-assistant reference, minimum completed turns, completed-turn interval, optional estimated-input-token threshold, number of recent turns to preserve verbatim, and maximum lengths for continuation and display summaries.

Automatic compaction runs only in the foreground after a completed chat response. A manual **Compact context** action provides the same explicit control as a `/compact` command and may run before the automatic threshold. No wall-clock scheduler, service-worker background sync, or closed-app timer is used.

The compaction request applies the referenced utility assistant's own prompt and model binding. It receives the previous checkpoint summary plus active-path messages after the prior boundary, stopping before the configured recent raw-message tail. One semantic call returns a versioned result containing:

```text
contextSummary: continuation state for future model requests
displaySummary: concise text used in the history list and fuzzy history search
```

The result is validated before commit. Success creates an immutable `ContextCheckpoint` with the covered boundary, active-path identity, completed-turn count, utility-assistant/model references and immutable source snapshot, previous-checkpoint reference, output revision, and timestamps. The conversation then atomically points to the new checkpoint and display summary. The utility prompt and output do not appear as visible conversation messages.

Failure retains the prior valid checkpoint and completed chat response, records a retryable error, and leaves newer messages in the raw tail. If the projected request approaches the active model's context limit without a valid compacted projection, the UI warns and requires successful compaction or a model/context change rather than silently dropping messages.

This is the only Memory mechanism in the first release: same-conversation canonical messages plus derived checkpoints and a recent raw tail. There is no user-level, assistant-level, project-level, or cross-conversation memory record.

### 11. Debug mode and context budget dashboard

Debug mode is an application setting that defaults off. When enabled, the conversation UI exposes a developer diagnostics panel for the latest request and response. It shows the pre-send `ContextBudgetReport`, post-response `UsageStats`, cache read/write rates where available, compaction decisions, active checkpoint identity, raw-tail boundaries, algorithmic anchor message IDs, and adapter diagnostics. API keys and credential headers are never rendered in debug output.

The dashboard distinguishes estimated, observed, and unsupported values. Estimated values come from the local projection builder before the request. Observed values come from provider usage fields after or during the response stream. Unsupported values are displayed when the provider or relay does not expose enough information. Cost estimates are optional and require configured per-model price categories for uncached input, cached input, cache writes, output, and reasoning tokens where applicable; they are labelled estimates, not invoices.

Assistant messages store local timing metadata. `createdAt` records when the placeholder/request starts, `completedAt` records when the message reaches a terminal state, and `elapsedMs` records browser-observed duration. This includes network, relay, queueing, hosted-tool, streaming, and buffering time, and is displayed as UX/debug metadata rather than provider billing usage.

Prompt-cache planning is local and conservative. Static prefix sections such as assistant instructions and stable formatting are placed before variable metadata and raw messages to improve possible provider cache reuse. The pre-send estimator computes `potentialCacheableRate` from the rendered stable prefix and computes `estimatedCacheReadHitRate` only from recent local observations with the same API profile, endpoint, protocol, provider model ID, optional prompt-cache key, request-shape version, and stable prefix fingerprint. The UI shows this estimate and confidence before send, then replaces or pairs it with observed cache read/write metrics from returned usage fields after the response. Provider cache state, routing, expiry, relay behavior, and traffic rate can still make the actual hit rate differ from the estimate.

### 12. Versioned compressed archive as the portability boundary

The portable format is a ZIP-compatible file with a `.mobilechat` extension rather than a raw IndexedDB, browser-profile, or SQLite file. Browser database files are implementation-specific and cannot be restored reliably across browsers. A complete archive contains:

```text
manifest.json       export format version, application version, timestamps, options
records.json        API profiles, assistants, conversations, messages, checkpoints, settings
blobs/<blob-id>     optional binary attachment payloads without Base64 expansion
checksums.json      per-entry integrity hashes
```

Complete migration mode includes API credentials after an explicit confirmation so another personal device can operate immediately; a credential-free export mode omits secret values while preserving profile and model metadata. Persistent browser file handles are never exported. Large exports report estimated size and attachment inclusion before creation.

Import reads the archive into an isolated representation, checks ZIP entry safety, checksums, export version, record schema, references, and blob metadata, then shows an import summary. Only after confirmation does it perform transactional replacement or ID-based merge. Merge preserves imported IDs when they do not conflict; unequal conflicts receive new IDs and all imported internal references, including checkpoint boundaries and source references, are remapped together. Replace clears domain stores only after validation succeeds.

Persistence and import/export use the same versioned record DTOs and migration path. Export reads a committed `MobileChatDB` snapshot, converts records into archive DTOs, and records export options such as credential inclusion, attachment inclusion, estimated size, app version, and schema version. Import parses into isolated DTOs first, migrates them if necessary, validates references, then writes to `MobileChatDB` in a single replace or merge transaction. The last successful export timestamp is stored in `settings` and displayed in backup settings.

Cross-device access is a manual export-transfer-import workflow through the phone or desktop file system, cloud drive, or another user-chosen transport. It does not imply account synchronization or a MobileChat server. A plain JSON diagnostic export may be offered separately, but `.mobilechat` is the normative complete-backup format.

### 13. Static deployment and verification

Use GitHub Actions to build and publish the static artifact to GitHub Pages. Verification includes unit tests for adapters, migrations, context projection, budget reports, usage normalization, compaction thresholds, checkpoint validity, archive round trips, and search scope; component tests for conversation, diagnostics, and settings flows; and browser tests at representative phone viewport sizes.

## Risks / Trade-offs

- **Direct endpoint CORS varies by provider** → Connection testing reports CORS separately and the first release documents that browser-compatible endpoints are required.
- **Provider Responses implementations may differ** → Normalize events through one adapter and preserve diagnostic details for unsupported terminal responses.
- **A relay may accept state parameters but ignore their semantics** → Keep `store: false` local projection as the only first-release context mechanism and treat provider continuation fields as diagnostics.
- **Browser storage can be evicted or cleared** → Provide visible backup/export controls and schema-versioned imports.
- **Large image/file blobs can exceed quota or backup size** → Check storage estimates, enforce configurable attachment limits, and warn before large imports or exports.
- **PWA updates can leave an old client open** → Use versioned caches and prompt the user to reload after a new service worker is ready.
- **Assistant snapshots duplicate prompts** → Accept bounded duplication to preserve provenance; never duplicate credentials.
- **User-defined titles or generated summaries may resemble instructions** → Delimit them as application-owned context metadata and keep them separate from the active assistant's instruction section.
- **Automatic compaction consumes model calls** → Make automation configurable, visible, and failure-isolated.
- **A compressed checkpoint can omit an important detail** → Preserve all canonical messages, keep a recent raw tail, expose manual recompression, and never make checkpoint generation destructive.
- **Editing a prior message creates branching complexity** → Store parent links from the beginning while exposing only one active path initially.
- **Mobile file editing support is inconsistent** → Keep write-back experimental and feature-detected; preview remains the supported baseline.
- **No cloud sync means device loss loses unexported data** → Make `.mobilechat` export/import a first-class settings capability and show the last successful export time locally.

## Migration Plan

1. Scaffold the typed PWA, tests, and GitHub Pages deployment without domain features.
2. Introduce schema version 1 and seed no user records; this is a new application with no legacy database.
3. Implement features behind local development verification, then publish a Pages preview/build artifact.
4. Validate installation, persistence, direct endpoint streaming, and IndexedDB behavior on Android Chrome and iOS Safari where available.
5. Treat future database changes as forward-only migrations; rollback deploys the previous static build without deleting newer local records.

## Open Questions

- Which mobile browsers grant usable read/write file handles and whether any write-back flow is reliable enough to graduate from experimental status. This does not block the initial implementation.
