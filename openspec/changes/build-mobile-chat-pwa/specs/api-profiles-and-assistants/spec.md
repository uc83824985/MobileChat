## ADDED Requirements

### Requirement: Reusable API profiles
The system SHALL allow a user to create, edit, disable, and delete API profiles containing a display name, API key, endpoint URL, protocol identifier, and zero or more model definitions.

#### Scenario: Configure one credential for multiple models
- **WHEN** a user adds multiple model definitions to one API profile
- **THEN** every model definition reuses that profile's endpoint, credential, and protocol without duplicating the credential

### Requirement: Configurable model definitions
The system SHALL allow each API profile to define one or more models with stable local identifiers, provider model IDs, display names, enabled state, default generation parameters, optional context-window metadata, and optional pricing metadata for local estimates.

#### Scenario: Disable a model without removing its history
- **WHEN** a user disables a configured model that appears in historical message snapshots
- **THEN** the model is unavailable for new selections while historical messages retain their recorded model information

#### Scenario: Configure optional pricing for diagnostics
- **WHEN** a user adds estimated pricing categories to a model definition
- **THEN** budget diagnostics can calculate estimated costs for that model while chat sending remains possible if pricing metadata is absent

### Requirement: Assistant encapsulation
The system SHALL allow a user to create, edit, disable, and delete assistants containing a kind, name, description, avatar, system prompt, optional initial message, and a list of model bindings.

#### Scenario: Reuse a model across assistants
- **WHEN** two assistants bind to the same model in the same API profile
- **THEN** both assistants reference the same API profile and model definition while retaining independent prompts and identities

### Requirement: Chat and utility assistant kinds
The system SHALL classify assistants as `chat` or `utility`, and SHALL require each utility assistant to declare a supported semantic role such as `context-compression`.

#### Scenario: Keep a compression result out of the visible chat
- **WHEN** a context-compression utility assistant successfully produces a checkpoint
- **THEN** the result is stored as derived conversation state and the utility assistant is not displayed as a speaker in the conversation

#### Scenario: Prevent a utility assistant from becoming the active speaker
- **WHEN** a user opens the active-assistant selector in a conversation
- **THEN** enabled utility assistants are excluded from chat-speaker choices and remain available only to compatible feature settings

### Requirement: Assistant model bindings
The system SHALL store model bindings inside the assistant definition as references to an API profile and one of its models, with optional display label, parameter overrides, and default selection.

#### Scenario: Bind an assistant to multiple providers and models
- **WHEN** a user adds model bindings from multiple API profiles to one assistant
- **THEN** the assistant can use any enabled binding and identifies one binding as its default

### Requirement: Quick active assistant and model switching
The system SHALL allow the active assistant and one of its model bindings to be changed from the conversation interface without creating a new conversation.

#### Scenario: Switch assistants in an existing conversation
- **WHEN** a user selects a different assistant and model binding in an active conversation
- **THEN** the conversation preserves all existing messages and uses the new assistant and model for the next generated response

### Requirement: API profile validation
The system SHALL provide an explicit connection test for an API profile and selected model and SHALL report browser cross-origin, authentication, endpoint, and protocol errors without saving generated chat content.

#### Scenario: Test an invalid endpoint
- **WHEN** a user tests an API profile whose endpoint cannot complete the configured protocol request
- **THEN** the settings surface displays an actionable failure and leaves existing profiles, assistants, and conversations unchanged

### Requirement: Initial OpenAI-compatible protocol adapters
The first release SHALL implement minimal OpenAI-compatible Responses and Chat Completions adapters using a locally constructed context projection, and SHALL store the protocol identifier so additional adapters can be added without migrating conversation records.

#### Scenario: Send using the supported adapter
- **WHEN** an enabled assistant model binding references an API profile configured for the Responses protocol
- **THEN** the system sends the conversation through that adapter and streams supported response events

#### Scenario: Send using Chat Completions
- **WHEN** an enabled assistant model binding references an API profile configured for the Chat Completions protocol
- **THEN** the system sends the assistant prompt as a system message, sends conversation records as chat messages, and streams supported choice deltas

#### Scenario: Relay buffers a streaming request
- **WHEN** the user enables streaming but a compatible relay returns a completed JSON response instead of server-sent events
- **THEN** the system parses the JSON response, stores the completed assistant message, and records that true incremental streaming was not observed

### Requirement: Explicit hosted tool capabilities
The system SHALL treat web search and other hosted provider tools as explicit per-turn send options for the selected protocol/profile/model rather than assuming that a prompt can make the model access the internet or statically enabling the tool on every request from a model.

#### Scenario: Enable web search for a Responses-compatible route
- **WHEN** a user enables web access for the next send through a Responses-compatible route
- **THEN** the request includes the adapter-specific tool configuration, such as a Responses `tools` entry for `web_search`, and stores any returned search/citation diagnostics without making them part of local memory

#### Scenario: Enable web search for a Chat Completions search route
- **WHEN** a user enables web access for the next send through a Chat Completions API profile
- **THEN** the request includes Chat Completions `web_search_options` rather than a Responses `tools` entry

#### Scenario: Web search is single-turn
- **WHEN** a user sends a message with the temporary web-access option enabled
- **THEN** that option is consumed for the current request and the next draft returns to the default non-web state unless the user enables it again

#### Scenario: Web search unsupported by the selected route
- **WHEN** a user sends a request that requires web access through a profile, model, or protocol that does not declare search support
- **THEN** the system reports the unsupported capability before or during send instead of silently relying on the model to browse

### Requirement: Explicit multimodal send capabilities
The system SHALL treat image, file, and other non-text content as per-draft content plus adapter-declared send capabilities, and SHALL serialize content parts only when the current draft includes them and the selected adapter/profile/model can accept them.

#### Scenario: Send an image-capable draft
- **WHEN** a draft contains an image URL or local image content part and the selected model binding declares image-input support
- **THEN** the request builder serializes the image using the adapter's expected content-part shape while preserving the local generic message record

#### Scenario: Multimodal input unsupported by route
- **WHEN** a draft contains an image or file content part but the active route does not declare support for that part type
- **THEN** the system blocks sending with a clear compatibility message and does not silently omit the content

### Requirement: Provider continuation is excluded from the first release
The first release SHALL NOT use provider-side response storage, `previous_response_id`, provider conversation IDs, or any returned continuation reference when building chat context or resuming conversations.

#### Scenario: Ignore a returned continuation identifier
- **WHEN** a provider response includes a response ID, conversation ID, or other continuation-looking field
- **THEN** the system may retain it as raw diagnostics but builds the next request from local records only

### Requirement: Provider usage normalization
The initial adapter SHALL normalize provider usage data into local usage fields for input, output, total, cached input, cache writes, reasoning tokens, and raw provider usage when those values are returned by the endpoint.

#### Scenario: Response includes cache usage
- **WHEN** a completed response reports input tokens and cached input tokens
- **THEN** the system stores both the normalized usage values and a cache-read hit rate calculated as cached input tokens divided by input tokens

#### Scenario: Response omits usage data
- **WHEN** a relay streams a successful response but omits usage or cache fields
- **THEN** the system marks observed usage and cache metrics as unknown while preserving the completed chat response

#### Scenario: Response omits only cached-token detail
- **WHEN** a completed response reports input tokens but omits cached input tokens
- **THEN** the system may display the input-token denominator but SHALL mark cached-token count and cache hit rate as not returned or unsupported rather than treating the value as zero
