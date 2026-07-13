## Context

MobileChat starts from an empty repository and targets personal use on modern mobile browsers. It must be deployable as static assets, call user-configured model endpoints directly, persist all application data locally, and remain structurally independent from any particular relay, assistant, or future message modality.

The initial endpoint already known to work exposes an OpenAI-compatible Responses API with browser CORS support, but the data model and protocol boundary must not assume that one endpoint forever. Mobile file write permissions are inconsistent across browsers, so content preview is required while source-file editing remains capability-gated and experimental.

## Goals / Non-Goals

**Goals:**

- Deliver an installable mobile-first PWA requiring no application backend.
- Support reusable API profiles with multiple models and assistants that reference those models.
- Separate user-facing chat assistants from utility assistants used for semantic derived-data tasks such as context compression.
- Preserve conversations through assistant, prompt, model, and credential changes.
- Allow assistant/model switching inside a shared conversation context with accurate per-response attribution.
- Preserve robust memory within each conversation using local canonical messages and compacted context checkpoints, independently of provider-side response storage.
- Provide local conversation management, metadata-only history search, in-conversation content search, and configurable context compaction.
- Establish versioned content-part and persistence schemas suitable for later multimodal expansion.
- Deploy repeatably to GitHub Pages from this repository.

**Non-Goals:**

- User accounts, cloud synchronization, collaborative sharing, or a remote application database.
- Cross-conversation user memory, assistant memory, preference extraction, or retrieval from other conversations.
- A general-purpose proxy or protection of API keys from the local device user.
- Native Anthropic, Gemini, Chat Completions, or other protocol adapters in the first release.
- Reliable background jobs while the PWA is closed.
- Guaranteed editing or write-back of phone files.
- Full-text search across messages in historical conversations.

## Decisions

### 1. React, TypeScript, and Vite static application

Use React with TypeScript and Vite to build a fully static single-page application. Add a manifest and generated service worker through a PWA build integration, and configure the router and asset base for the `/MobileChat/` GitHub Pages path.

This provides a small, conventional frontend toolchain with compile-time data model checks and no server runtime. A single hand-authored HTML file was considered, but rejected because the required IndexedDB migrations, multiple settings surfaces, streaming lifecycle, and testable state transitions would become difficult to maintain.

### 2. IndexedDB repository layer with explicit migrations

Use IndexedDB behind a typed repository boundary. A small IndexedDB helper library may manage transactions and schema upgrades, but domain code must not expose library-specific record types. UI preferences that are safe to lose may use `localStorage`; domain records do not.

Primary stores:

```text
apiProfiles
assistants
conversations
messages
blobs
drafts
contextCheckpoints
appSettings
migrationMetadata
```

Every record uses a stable application-generated ID, ISO timestamp fields, and an explicit record version. Database upgrades run ordered migrations inside transactions where the browser permits them. Exported backups carry an independent export schema version.

### 3. API profiles aggregate models

Do not persist separate Connection and ModelRoute entities. An `ApiProfile` owns the endpoint, API key, protocol, and its model definitions:

```ts
type ApiProfile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  protocol: "openai-responses";
  enabled: boolean;
  models: ModelDefinition[];
};
```

If two models need different credentials, headers, URLs, or protocols, they belong to different API profiles. Updating a credential updates every assistant binding that references it.

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

Canonical conversation memory consists of locally persisted messages on the active path. The model has no durable memory of a prior browser request, and provider response IDs are neither portable across profiles nor reliable across compatible relays. The local database is therefore the source of truth even if a future adapter can use a provider-side continuation ID as an optimization.

For every chat request, the request builder produces a deterministic `ConversationContextProjection` in this order:

```text
current chat assistant prompt
current conversation metadata, including the latest title
latest valid context checkpoint summary
raw active-path messages after the checkpoint boundary
latest user message
```

The context checkpoint replaces the covered older messages in the model input; it is not appended in addition to the full covered history. Covered messages remain in IndexedDB and remain visible, searchable inside the open conversation, exportable, and available for rebuilding a checkpoint. Only the currently selected chat assistant's system prompt is applied. Earlier assistants' visible messages remain ordinary shared context, while their old system prompts are not replayed.

The latest title and checkpoint summary are serialized as clearly delimited application-owned context, not executable instructions. The title is deliberately kept outside the checkpoint, so renaming a conversation updates the next request without invalidating or regenerating the checkpoint. Empty fields are omitted, and no synthetic synchronization message is persisted.

Messages include `parentMessageId` and the conversation records the active leaf. Edit-and-resubmit, regeneration, or active-branch changes invalidate a checkpoint when its covered boundary is not an ancestor of the new active leaf. Invalid checkpoints remain auditable but are not used; the application rebuilds from the active raw path until compaction succeeds. No context is silently borrowed from another conversation.

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

Implement only `openai-responses` initially. It sends the local context projection, the current assistant instructions, `stream: true`, and `store: false`, then normalizes output-text deltas, completion, refusal, and error events. Provider-specific events not understood by the adapter are ignored only when they do not contain user-visible output or terminal errors.

The adapter capability model may later expose provider continuation modes such as `previous_response_id` or provider conversation IDs, but they are never the only stored representation of a conversation. A capability probe must verify semantic continuity, not merely a 2xx response or the presence of an ID. Switching API profile, model, assistant, or active branch can discard provider continuation state and rebuild the request from the local projection.

Compatibility observation from 2026-07-13: `https://api.mnapi.com/v1` returned 200 for a baseline `gpt-5.4` Responses request and also accepted `store: true` plus `previous_response_id`. However, retrieving the created Response returned 404 and the chained request did not recall a unique marker from the stored response. MobileChat therefore treats provider state chaining on this relay as unsupported. The launcher-configured `gpt-5.4-codex-high` was not present in the relay's model listing and returned 503, which is a separate model-route issue rather than evidence about state support.

### 8. Typed content parts and separate blob records

Messages use ordered `contents` rather than a single provider payload. Initial part types include text plus metadata-bearing local image/file references. Binary data is stored once in a `blobs` store and referenced by content parts; previews use temporary object URLs.

The initial protocol adapter guarantees text. A draft containing non-text parts can be previewed and persisted, but can be sent only when the active adapter declares support for those part types. This prevents accidental omission. Backup export stores selected blob records as archive entries instead of embedding large binary payloads in JSON.

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

### 11. Versioned compressed archive as the portability boundary

The portable format is a ZIP-compatible file with a `.mobilechat` extension rather than a raw IndexedDB, browser-profile, or SQLite file. Browser database files are implementation-specific and cannot be restored reliably across browsers. A complete archive contains:

```text
manifest.json       export format version, application version, timestamps, options
records.json        API profiles, assistants, conversations, messages, checkpoints, settings
blobs/<blob-id>     optional binary attachment payloads without Base64 expansion
checksums.json      per-entry integrity hashes
```

Complete migration mode includes API credentials after an explicit confirmation so another personal device can operate immediately; a credential-free export mode omits secret values while preserving profile and model metadata. Persistent browser file handles are never exported. Large exports report estimated size and attachment inclusion before creation.

Import reads the archive into an isolated representation, checks ZIP entry safety, checksums, export version, record schema, references, and blob metadata, then shows an import summary. Only after confirmation does it perform transactional replacement or ID-based merge. Merge preserves imported IDs when they do not conflict; unequal conflicts receive new IDs and all imported internal references, including checkpoint boundaries and source references, are remapped together. Replace clears domain stores only after validation succeeds.

Cross-device access is a manual export-transfer-import workflow through the phone or desktop file system, cloud drive, or another user-chosen transport. It does not imply account synchronization or a MobileChat server. A plain JSON diagnostic export may be offered separately, but `.mobilechat` is the normative complete-backup format.

### 12. Static deployment and verification

Use GitHub Actions to build and publish the static artifact to GitHub Pages. Verification includes unit tests for adapters, migrations, context projection, compaction thresholds, checkpoint validity, archive round trips, and search scope; component tests for conversation and settings flows; and browser tests at representative phone viewport sizes.

## Risks / Trade-offs

- **Direct endpoint CORS varies by provider** → Connection testing reports CORS separately and the first release documents that browser-compatible endpoints are required.
- **Provider Responses implementations may differ** → Normalize events through one adapter and preserve diagnostic details for unsupported terminal responses.
- **A relay may accept state parameters but ignore their semantics** → Keep `store: false` local projection as the baseline and require a recall-based capability probe before enabling provider continuation.
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
