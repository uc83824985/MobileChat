## ADDED Requirements

### Requirement: Installable mobile application shell
The system SHALL provide a responsive static web application that can be installed to a supported mobile device home screen and launched without a continuously running application server.

#### Scenario: Install and relaunch from a phone home screen
- **WHEN** a user installs the application from a supported mobile browser and later launches its home-screen icon
- **THEN** the application opens into the last available local application state without requiring a PC-hosted service

### Requirement: Mobile-first navigation
The system SHALL provide mobile-accessible navigation between the conversation list, active conversation, assistant selection, archived conversations, and settings.

#### Scenario: Navigate on a narrow viewport
- **WHEN** the application is displayed on a phone-sized viewport
- **THEN** conversation management is available through a compact drawer or equivalent mobile control without obscuring the active chat permanently

### Requirement: Offline application shell
The system SHALL cache the static application shell and SHALL distinguish between offline application access and network-dependent chat operations.

#### Scenario: Open the application while offline
- **WHEN** a previously installed user opens the application without network connectivity
- **THEN** locally stored settings and conversations remain readable and chat sending is disabled with a clear offline indication

### Requirement: Dedicated settings surface
The system SHALL reserve a settings surface for API profiles, assistants, summary rules, data portability, appearance, and future application options.

#### Scenario: Open settings from a conversation
- **WHEN** a user activates the settings control from the chat interface
- **THEN** the system opens the settings surface without deleting or replacing the active conversation

