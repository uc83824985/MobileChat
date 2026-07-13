## ADDED Requirements

### Requirement: Unified MobileChatDB database
The system SHALL use one versioned IndexedDB database named `MobileChatDB` as the source of truth for local domain records, including metadata, settings, API profiles, assistants, conversations, messages, drafts, context checkpoints, and blobs.

#### Scenario: Open the app on phone after prior configuration
- **WHEN** the user relaunches the application on the same browser origin after configuring assistants or API profiles
- **THEN** the application restores those records from `MobileChatDB` without requiring a backend or development computer

#### Scenario: Upgrade local schema
- **WHEN** application code requires a newer supported schema version
- **THEN** it runs ordered migrations for `MobileChatDB` before exposing records to the UI

### Requirement: Indexed local persistence
The system SHALL persist API profiles, model definitions, assistants, conversations, messages, context checkpoints, display summaries, drafts, blobs, and application settings in browser-managed local storage using a versioned IndexedDB schema for structured records.

#### Scenario: Reload after local changes
- **WHEN** a user reloads or relaunches the application after saving data
- **THEN** the latest committed local records are restored without contacting an application backend

### Requirement: Non-blocking autosave
The system SHALL apply UI edits to in-memory state immediately and SHALL persist changed records to `MobileChatDB` asynchronously without blocking typing, scrolling, or selection interactions.

#### Scenario: Edit assistant prompt on a phone
- **WHEN** the user types into a large assistant prompt field
- **THEN** the text input remains responsive while the application debounces and commits only the changed assistant record

#### Scenario: Flush pending edits
- **WHEN** a user blurs a field, closes settings, sends a message, or the page becomes hidden
- **THEN** any pending dirty records are flushed to `MobileChatDB` before the state is considered saved

#### Scenario: Save status is visible
- **WHEN** a background save is pending, committed, or fails
- **THEN** the UI exposes a local save status such as unsaved, saving, saved, or failed without leaking credentials

### Requirement: Persistent storage request and quota observability
The system SHALL request persistent storage when available after meaningful local configuration exists and SHALL expose storage mode and estimated usage/quota in settings or debug diagnostics.

#### Scenario: Browser grants persistent storage
- **WHEN** `navigator.storage.persist()` resolves to true
- **THEN** the application records that storage is persistent and informs the user that browser-managed eviction risk is reduced but manual export is still recommended

#### Scenario: Browser denies or lacks persistent storage
- **WHEN** persistent storage is unavailable or denied
- **THEN** the application continues to function with best-effort storage and makes backup/export status visible

#### Scenario: Quota information is available
- **WHEN** `navigator.storage.estimate()` returns usage and quota
- **THEN** the application displays the values as estimates and handles quota exceeded write failures as recoverable local storage errors

### Requirement: Assistant-independent stored records
Conversation and message records SHALL remain readable and exportable without resolving a live assistant, API profile, model definition, or credential.

#### Scenario: Remove all assistant configuration
- **WHEN** all assistants and API profiles are removed
- **THEN** historical conversations and messages remain readable from their generic content and stored snapshots

### Requirement: Versioned schema migration
The system SHALL assign a schema version to persisted and exported data and SHALL run ordered, testable migrations before newer application code uses older records.

#### Scenario: Open data from an earlier schema
- **WHEN** the application encounters a supported earlier schema version
- **THEN** it migrates the data transactionally or leaves the original data intact and reports a recoverable migration failure

### Requirement: Portable compressed backup archive
The system SHALL export a ZIP-compatible `.mobilechat` archive containing a versioned manifest, structured records, optional binary blob entries, and integrity checks required to restore the selected application state on another supported browser or device.

#### Scenario: Export committed local records
- **WHEN** a user starts an export
- **THEN** the archive is produced from committed `MobileChatDB` records using the same versioned record DTOs as local persistence, not from transient React state alone

#### Scenario: Export a complete migration backup
- **WHEN** a user confirms a complete export including credentials and attachments
- **THEN** the browser produces one `.mobilechat` file containing the required records, API credentials, attachment entries, and checksums without requiring a server

#### Scenario: Export without credentials
- **WHEN** a user selects credential-free export
- **THEN** the archive preserves API-profile and model metadata but omits secret values and reports that credentials must be re-entered after import

### Requirement: Portable format is independent of browser database files
The system SHALL NOT use a raw IndexedDB directory, browser-profile file, or implementation-specific database file as its backup interchange format.

#### Scenario: Move between different browser implementations
- **WHEN** a valid `.mobilechat` archive exported by one supported browser is imported by another
- **THEN** the receiving application reconstructs records through the application schema without depending on the source browser's IndexedDB representation

### Requirement: Validated backup import
The system SHALL validate archive entry paths, checksums, export version, record schemas, references, and declared blobs before mutation and SHALL allow the user to merge the archive with or replace current local data after presenting an import summary.

#### Scenario: Import before local mutation
- **WHEN** a user selects a `.mobilechat` archive
- **THEN** the application parses, migrates, and validates the archive in isolation before opening a write transaction against `MobileChatDB`

#### Scenario: Reject an invalid backup
- **WHEN** a selected file has unsupported schema metadata or invalid required records
- **THEN** the system rejects the import and leaves current local data unchanged

#### Scenario: Replace local data from a valid backup
- **WHEN** a user confirms replacement using a validated compatible backup
- **THEN** the system transactionally replaces current data and reloads the restored application state

#### Scenario: Merge records with conflicting IDs
- **WHEN** an imported record ID already exists locally with unequal content
- **THEN** the system assigns a new local ID and consistently remaps every imported reference, including message parents, active leaves, checkpoint boundaries, assistant bindings, and blob references

### Requirement: Manual cross-device migration
The system SHALL support cross-device use through an explicit export-transfer-import workflow and SHALL NOT present this workflow as live synchronization.

#### Scenario: Restore on a second phone
- **WHEN** a user transfers a `.mobilechat` archive to a second device and imports it
- **THEN** the second device can restore the selected conversations and configuration locally while subsequent changes on either device remain independent

### Requirement: Export observability
The system SHALL record the last successful export timestamp locally and SHALL show estimated archive size and attachment inclusion before creating a potentially large backup.

#### Scenario: Browser storage is at risk
- **WHEN** the user opens backup settings after creating additional local conversations
- **THEN** the UI shows the last successful export time so the user can decide whether to create a newer portable backup

### Requirement: Local-only operation
The system SHALL NOT require an application account, remote database, continuously running personal computer, or custom application server for persistence and conversation management.

#### Scenario: Use from a different network
- **WHEN** the installed application and configured model endpoint are reachable from a phone network
- **THEN** the user can manage local conversations and send chat requests without reaching the development computer
