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

#### Scenario: Preserve image labels across send
- **WHEN** a user attaches one or more images to a draft
- **THEN** the composer assigns stable visible labels such as `[图片1]`, `[图片2]` in message order
- **AND** the provider request includes adjacent text labels so the assistant can map each visible placeholder to the corresponding image content part

#### Scenario: Clear image cache after messages exist
- **WHEN** image cache blobs are cleared after messages have been saved
- **THEN** the messages keep their image reference metadata and visible placeholders
- **AND** previews render a missing-cache state such as **图片缓存已清理**
- **AND** later provider requests serialize a text-only placeholder for the missing image rather than an empty image object

#### Scenario: Render assistant choice blocks
- **WHEN** an assistant message contains a fenced `mobilechat-choice` block with `type: "mobilechat.choice.v1"`
- **THEN** the application hides the raw protocol block from the normal message text
- **AND** renders the parsed title, description, and choices as a stable clickable choice card inside the message
- **AND** validates the number of choices against the user-configured maximum choice count, defaulting to 8
- **AND** each choice card defaults to expanded and may be collapsed or expanded in the current runtime session without persisting that view state to IndexedDB or exports
- **AND** clicking a choice inserts its `insertText` into the composer without automatically sending it
- **AND** the current-conversation search index includes parsed choice titles, descriptions, labels, and insertion text so old alternatives can be found again

#### Scenario: Invalid assistant choice block
- **WHEN** an assistant message contains a fenced `mobilechat-choice` block that is not valid JSON or does not match `mobilechat.choice.v1`
- **THEN** the raw block remains hidden
- **AND** the message shows a local parse-error card explaining why the choice block could not be rendered
- **AND** the ordinary visible message text remains readable

#### Scenario: File access is denied
- **WHEN** the browser or user denies access to selected local content
- **THEN** the application remains usable and reports that the content could not be read without altering the source file

### Requirement: Optional mobile file editing
Writing changes back to a local file SHALL be treated as an optional experimental capability gated by runtime feature and permission detection and SHALL NOT be required for core chat, preview, or persistence behavior.

#### Scenario: Editing API is unavailable
- **WHEN** the mobile browser does not expose a supported writable file API
- **THEN** preview and chat remain available and local-file editing controls are hidden or marked unavailable
