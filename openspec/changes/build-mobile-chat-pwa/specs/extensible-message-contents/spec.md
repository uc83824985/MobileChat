## ADDED Requirements

### Requirement: Versioned message content parts
The system SHALL store message bodies as an ordered, versioned array of typed content parts rather than as an assistant-specific message payload.

#### Scenario: Store a text message
- **WHEN** a user or assistant produces text content
- **THEN** the message stores a text content part that can be rendered, searched, exported, imported, and processed independently of the generating assistant

### Requirement: Content capability negotiation
The system SHALL declare which content-part types each protocol adapter can send and receive and SHALL prevent unsupported parts from being silently omitted from a network request.

#### Scenario: Attempt to send an unsupported content type
- **WHEN** a draft contains a content part not supported by the active protocol adapter
- **THEN** the system identifies the unsupported part and requires its removal or a compatible model binding before sending

### Requirement: Local content selection and preview
The system SHALL use browser-supported file selection to create local draft content parts and SHALL preview supported text and browser-decodable image content without requiring write permission to the source file.

#### Scenario: Preview a selected image
- **WHEN** a user selects an image that the browser can decode and read
- **THEN** the draft displays a local preview and file metadata before the message is sent or saved

#### Scenario: File access is denied
- **WHEN** the browser or user denies access to selected local content
- **THEN** the application remains usable and reports that the content could not be read without altering the source file

### Requirement: Optional mobile file editing
Writing changes back to a local file SHALL be treated as an optional experimental capability gated by runtime feature and permission detection and SHALL NOT be required for core chat, preview, or persistence behavior.

#### Scenario: Editing API is unavailable
- **WHEN** the mobile browser does not expose a supported writable file API
- **THEN** preview and chat remain available and local-file editing controls are hidden or marked unavailable
