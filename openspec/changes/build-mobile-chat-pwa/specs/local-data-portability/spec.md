## ADDED Requirements

### Requirement: Indexed local persistence
The system SHALL persist API profiles, model definitions, assistants, conversations, messages, summaries, drafts, and application settings in browser-managed local storage using a versioned IndexedDB schema for structured records.

#### Scenario: Reload after local changes
- **WHEN** a user reloads or relaunches the application after saving data
- **THEN** the latest committed local records are restored without contacting an application backend

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

### Requirement: Complete local backup export
The system SHALL export a versioned JSON backup containing the locally stored configuration, assistants, conversations, messages, summaries, and settings required to restore the application state.

#### Scenario: Export a backup
- **WHEN** a user requests a complete export
- **THEN** the browser produces a JSON file containing schema metadata and all selected local records without requiring a server

### Requirement: Validated backup import
The system SHALL validate an imported backup before mutation and SHALL allow the user to merge it with or replace current local data after presenting an import summary.

#### Scenario: Reject an invalid backup
- **WHEN** a selected file has unsupported schema metadata or invalid required records
- **THEN** the system rejects the import and leaves current local data unchanged

#### Scenario: Replace local data from a valid backup
- **WHEN** a user confirms replacement using a validated compatible backup
- **THEN** the system transactionally replaces current data and reloads the restored application state

### Requirement: Local-only operation
The system SHALL NOT require an application account, remote database, continuously running personal computer, or custom application server for persistence and conversation management.

#### Scenario: Use from a different network
- **WHEN** the installed application and configured model endpoint are reachable from a phone network
- **THEN** the user can manage local conversations and send chat requests without reaching the development computer

