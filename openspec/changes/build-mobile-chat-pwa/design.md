## Context

MobileChat starts from an empty repository and targets personal use on modern mobile browsers. It must be deployable as static assets, call user-configured model endpoints directly, persist all application data locally, and remain structurally independent from any particular relay, assistant, or future message modality.

The initial endpoint already known to work exposes an OpenAI-compatible Responses API with browser CORS support, but the data model and protocol boundary must not assume that one endpoint forever. Mobile file write permissions are inconsistent across browsers, so content preview is required while source-file editing remains capability-gated and experimental.

## Goals / Non-Goals

**Goals:**

- Deliver an installable mobile-first PWA requiring no application backend.
- Support reusable API profiles with multiple models and assistants that reference those models.
- Preserve conversations through assistant, prompt, model, and credential changes.
- Allow assistant/model switching inside a shared conversation context with accurate per-response attribution.
- Provide local conversation management, metadata-only history search, in-conversation content search, and configurable turn-based summaries.
- Establish versioned content-part and persistence schemas suitable for later multimodal expansion.
- Deploy repeatably to GitHub Pages from this repository.

**Non-Goals:**

- User accounts, cloud synchronization, collaborative sharing, or a remote application database.
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

Do not persist a standalone AssistantRoute entity. An `Assistant` owns identity and prompt data plus model references:

```ts
type Assistant = {
  id: string;
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

### 5. Generic conversations plus immutable source snapshots

A conversation stores the assistant/model selection intended for the next response and a snapshot for display if the referenced configuration disappears. Each assistant message independently records the actual source used for that response.

```text
Conversation
  activeAssistantId
  activeModelRef { apiProfileId, modelId }
  activeSourceSnapshot
  title
  summary
  summaryState
  status

Assistant Message
  assistantId
  modelRef
  sourceSnapshot
    assistantName, description, avatar, systemPrompt
    modelId, modelName, effectiveParameters
```

Snapshots never include API keys. The message snapshot is immutable after the response begins. This intentionally duplicates small identity and prompt fields so assistant deletion or later editing cannot erase historical attribution or the generation context.

### 6. Shared message context and current-assistant instructions

The request builder walks the active conversation path and converts its user and assistant content parts into protocol input. It adds only the currently selected assistant's system prompt as request instructions. Previous assistants' messages remain ordinary shared context; their system prompts are not replayed.

At send time, the builder also reads the latest persisted conversation title and summary and serializes them into a clearly delimited application-owned metadata block. The block labels both fields as context rather than executable instructions. Empty fields are omitted. This metadata is rebuilt for every request and is not persisted as a synthetic chat message.

Editing a title or successfully updating a summary therefore requires only an atomic conversation-record update. The next request observes the new values automatically; prior messages, branches, and source snapshots are never rewritten or backfilled. This keeps assistant awareness current without introducing hidden history entries or synchronization calls.

Messages include `parentMessageId` and the conversation records the active leaf. The first UI may present one active linear path, but edit-and-resubmit and regeneration create a new child path rather than destructively rewriting the original message records.

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

Implement only `openai-responses` initially. It sends a full stateless conversation input, the current assistant instructions, `stream: true`, and `store: false`, then normalizes output-text deltas, completion, refusal, and error events. Provider-specific events not understood by the adapter are ignored only when they do not contain user-visible output or terminal errors.

### 8. Typed content parts and separate blob records

Messages use ordered `contents` rather than a single provider payload. Initial part types include text plus metadata-bearing local image/file references. Binary data is stored once in a `blobs` store and referenced by content parts; previews use temporary object URLs.

The initial protocol adapter guarantees text. A draft containing non-text parts can be previewed and persisted, but can be sent only when the active adapter declares support for those part types. This prevents accidental omission. Backup export encodes selected blob records in a JSON-compatible form.

Writable file handles are never required by the domain model. If a supported browser grants a persistent writable handle, it is stored as optional capability metadata and accessed behind an experimental feature flag.

### 9. Separate current and historical search indexes

Current-conversation search derives an in-memory fuzzy index from searchable text content parts for the active conversation. Historical search maintains a lightweight index containing only conversation ID, title, and summary. Historical message bodies are never loaded or searched for global history queries.

Search normalization handles Unicode case folding, whitespace, and punctuation consistently. A bundled fuzzy matcher may be used, but its scoring and highlighting are wrapped behind an application search service so the library can be replaced.

### 10. Turn-triggered incremental summaries

A completed turn is a user message followed by a terminal assistant message status. Global summary defaults may be overridden per conversation and include enablement, minimum completed turns, update interval, model reference, prompt template, and maximum output length.

After a qualifying assistant response completes, the foreground application enqueues a summary attempt. It sends the previous summary and messages after `summaryThroughMessageId`, using the configured API-profile model reference and a summary-specific prompt rather than a chat assistant prompt. Success atomically updates summary text, covered message boundary, and completed-turn count; failure records a retryable error without changing the chat response.

No wall-clock scheduler, service-worker background sync, or closed-app timer is used.

### 11. Local backup as the portability boundary

Export produces a versioned JSON document with application metadata, relational records, and optionally encoded blob data. Import parses into an isolated in-memory representation, validates references and schema compatibility, shows a summary, then performs either transactional replacement or ID-based merge.

Merge preserves imported IDs when they do not conflict. Conflicting records with unequal content receive new IDs and all imported internal references are remapped together. Replace clears domain stores only after validation succeeds.

### 12. Static deployment and verification

Use GitHub Actions to build and publish the static artifact to GitHub Pages. Verification includes unit tests for adapters, migrations, context building, summary thresholds, and search scope; component tests for conversation and settings flows; and browser tests at representative phone viewport sizes.

## Risks / Trade-offs

- **Direct endpoint CORS varies by provider** → Connection testing reports CORS separately and the first release documents that browser-compatible endpoints are required.
- **Provider Responses implementations may differ** → Normalize events through one adapter and preserve diagnostic details for unsupported terminal responses.
- **Browser storage can be evicted or cleared** → Provide visible backup/export controls and schema-versioned imports.
- **Large image/file blobs can exceed quota or backup size** → Check storage estimates, enforce configurable attachment limits, and warn before large imports or exports.
- **PWA updates can leave an old client open** → Use versioned caches and prompt the user to reload after a new service worker is ready.
- **Assistant snapshots duplicate prompts** → Accept bounded duplication to preserve provenance; never duplicate credentials.
- **User-defined titles or generated summaries may resemble instructions** → Delimit them as application-owned context metadata and keep them separate from the active assistant's instruction section.
- **Automatic summaries consume model calls** → Make automation configurable, visible, and failure-isolated.
- **Editing a prior message creates branching complexity** → Store parent links from the beginning while exposing only one active path initially.
- **Mobile file editing support is inconsistent** → Keep write-back experimental and feature-detected; preview remains the supported baseline.
- **No cloud sync means device loss loses unsaved data** → Make local export/import a first-class settings capability.

## Migration Plan

1. Scaffold the typed PWA, tests, and GitHub Pages deployment without domain features.
2. Introduce schema version 1 and seed no user records; this is a new application with no legacy database.
3. Implement features behind local development verification, then publish a Pages preview/build artifact.
4. Validate installation, persistence, direct endpoint streaming, and IndexedDB behavior on Android Chrome and iOS Safari where available.
5. Treat future database changes as forward-only migrations; rollback deploys the previous static build without deleting newer local records.

## Open Questions

- Which mobile browsers grant usable read/write file handles and whether any write-back flow is reliable enough to graduate from experimental status. This does not block the initial implementation.
