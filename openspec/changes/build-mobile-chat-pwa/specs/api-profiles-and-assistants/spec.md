## ADDED Requirements

### Requirement: Reusable API profiles
The system SHALL allow a user to create, edit, disable, and delete API profiles containing a display name, API key, endpoint URL, protocol identifier, and zero or more model definitions.

#### Scenario: Configure one credential for multiple models
- **WHEN** a user adds multiple model definitions to one API profile
- **THEN** every model definition reuses that profile's endpoint, credential, and protocol without duplicating the credential

### Requirement: Configurable model definitions
The system SHALL allow each API profile to define one or more models with stable local identifiers, provider model IDs, display names, enabled state, and default generation parameters.

#### Scenario: Disable a model without removing its history
- **WHEN** a user disables a configured model that appears in historical message snapshots
- **THEN** the model is unavailable for new selections while historical messages retain their recorded model information

### Requirement: Assistant encapsulation
The system SHALL allow a user to create, edit, disable, and delete assistants containing a name, description, avatar, system prompt, optional initial message, and a list of model bindings.

#### Scenario: Reuse a model across assistants
- **WHEN** two assistants bind to the same model in the same API profile
- **THEN** both assistants reference the same API profile and model definition while retaining independent prompts and identities

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

### Requirement: Initial Responses API protocol
The first release SHALL implement a minimal OpenAI-compatible Responses API adapter and SHALL store the protocol identifier so additional adapters can be added without migrating conversation records.

#### Scenario: Send using the supported adapter
- **WHEN** an enabled assistant model binding references an API profile configured for the initial Responses protocol
- **THEN** the system sends the conversation through that adapter and streams supported response events

