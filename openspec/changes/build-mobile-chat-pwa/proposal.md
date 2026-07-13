## Why

MobileChat needs a phone-first, one-tap chat experience that can talk directly to configurable OpenAI-compatible API endpoints without requiring a continuously reachable PC or application server. The application must remain useful as assistants, credentials, models, and message formats evolve, while keeping all user data portable and locally owned.

## What Changes

- Add an installable static PWA optimized for mobile browsers and direct API access.
- Add reusable API profiles that each contain an endpoint, credential, protocol selection, and one or more configured models.
- Add assistants that encapsulate identity, description, avatar, prompt, initial message, and references to one or more models from API profiles.
- Add local-first conversation and message persistence with versioned, assistant-independent records and source snapshots that survive assistant or model deletion.
- Allow the active assistant and model to change within an existing conversation while sharing the same conversation context.
- Add ChatGPT-style conversation and message presentation, streaming responses, and core conversation management.
- Make the current user-defined title and latest summary available to the active assistant as dynamic conversation metadata on every request.
- Add in-conversation message search and history search limited to user-editable titles and generated summaries.
- Add configurable, turn-based automatic conversation summary updates without background timers.
- Add extensible message `contents` suitable for future multimodal input, with first-pass local content selection and preview; editing remains experimental pending mobile permission testing.
- Add local import/export and schema migration foundations so data can be reused across application and assistant iterations.

## Capabilities

### New Capabilities

- `mobile-pwa-shell`: Installable, responsive static application shell, navigation, offline asset caching, and settings entry points.
- `api-profiles-and-assistants`: Reusable API profiles, model catalogs, assistant definitions, model references, validation, and quick assistant/model switching.
- `conversations-and-messages`: Chat presentation, streaming Responses API interaction, shared context, source snapshots, and complete conversation lifecycle management.
- `conversation-search-and-summaries`: Current-conversation message search, title/summary history search, editable titles, and configurable turn-based summary generation.
- `extensible-message-contents`: Versioned content-part storage and preview behavior for text and future multimodal message contents.
- `local-data-portability`: Indexed local persistence, schema migrations, backup export/import, and assistant-independent data retention.

### Modified Capabilities

None. This is a new repository with no existing product specifications.

## Impact

- Introduces the initial frontend application, client-side persistence layer, API protocol adapter, PWA assets, and static hosting configuration.
- Stores API credentials and all conversation data in the user's browser; no application backend or cloud database is required.
- The initial network adapter targets a minimal OpenAI-compatible Responses API contract while preserving an adapter boundary for later protocols.
- Mobile file editing is not a release requirement; only permission-tolerant selection and preview are required initially.
