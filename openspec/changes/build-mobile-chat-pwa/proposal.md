## Why

MobileChat needs a phone-first, one-tap chat experience that can talk directly to configurable OpenAI-compatible API endpoints without requiring a continuously reachable PC or application server. The application must remain useful as assistants, credentials, models, and message formats evolve, while keeping all user data portable and locally owned.

## What Changes

- Add an installable static PWA optimized for mobile browsers and direct API access.
- Add reusable API profiles that each contain an endpoint, credential, protocol selection, and one or more configured models.
- Add assistants that encapsulate identity, description, avatar, prompt, initial message, and references to one or more models from API profiles.
- Classify assistants as user-facing chat assistants or non-chat utility assistants used by explicit built-in feature references.
- Add local-first conversation and message persistence with versioned, assistant-independent records and source snapshots that survive assistant or model deletion.
- Allow the active assistant and model to change within an existing conversation while sharing the same conversation context.
- Define memory strictly within one conversation, using canonical local messages, a rolling context summary, and a recent raw-message tail; do not add cross-conversation memory.
- Build all chat request context locally with `store: false`; do not use provider-side response storage, `previous_response_id`, or provider conversation IDs in the first release.
- Add local context budget reporting, pre-send cache estimates, provider usage normalization, and a settings-controlled debug mode that exposes developer diagnostics for context composition and cache metrics.
- Add ChatGPT-style conversation and message presentation, streaming responses, and core conversation management.
- Make the current user-defined title and latest context summary available to the active assistant as dynamic conversation metadata on every request.
- Add in-conversation message search and history search limited to user-editable titles and generated summaries.
- Add configurable foreground context summarization that references a utility assistant, can run manually or after a message-count interval, and never deletes visible history.
- Add extensible message `contents` suitable for future multimodal input, with first-pass local image selection, paste support, preview, cache cleanup fallbacks, and request-time image label mapping; editing remains experimental pending mobile permission testing.
- Add a model-probing workbench that expands user-maintained candidate rules, tests the currently selected connection, shows successful model IDs, and lets the user create configured models without binding them to assistants automatically.
- Tighten settings terminology and layout around connection, model, assistant, context configuration, and probe records; autosave is silent unless there is an error or backup/storage risk, and destructive actions use object-specific labels.
- Add local import/export foundations, centered on a versioned compressed `.mobilechat` archive, so complete local state can be moved manually across devices and reused across application and assistant iterations. During rapid iteration, older app schemas may require reconfiguration instead of automatic migration.

## Capabilities

### New Capabilities

- `mobile-pwa-shell`: Installable, responsive static application shell, navigation, offline asset caching, and settings entry points.
- `api-profiles-and-assistants`: Reusable API profiles, model catalogs, assistant definitions, model references, validation, and quick assistant/model switching.
- `conversations-and-messages`: Chat presentation, streaming Responses API interaction, shared context, source snapshots, and complete conversation lifecycle management.
- `conversation-search-and-summaries`: Current-conversation message search, title/summary history search, editable titles, and configurable single-conversation context summarization through a utility assistant.
- `extensible-message-contents`: Versioned content-part storage and preview behavior for text and future multimodal message contents.
- `local-data-portability`: Indexed local persistence, current-schema validation, compressed backup archive export/import, manual cross-device transfer, and assistant-independent data retention.

### Modified Capabilities

None. This is a new repository with no existing product specifications.

## Impact

- Introduces the initial frontend application, client-side persistence layer, API protocol adapter, PWA assets, and static hosting configuration.
- Stores API credentials and all conversation data in the user's browser; no application backend or cloud database is required.
- The initial network adapter targets a minimal OpenAI-compatible Responses API contract while preserving an adapter boundary for later protocols.
- Provider-side response storage and continuation are not first-release capabilities; the initial adapter always uses local stateless context because compatible relays may accept state parameters without implementing their semantics.
- Cache hit rates and cost dashboards are diagnostics: request construction estimates cacheability and likely hit rate from local prefix observations, while actual cache read/write metrics are shown only when the provider returns compatible usage fields.
- Mobile file editing is not a release requirement; only permission-tolerant selection and preview are required initially.
