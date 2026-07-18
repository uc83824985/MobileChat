## ADDED Requirements

### Requirement: Installable mobile application shell
The system SHALL provide a responsive static web application that can be installed to a supported mobile device home screen and launched without a continuously running application server.

#### Scenario: Install and relaunch from a phone home screen
- **WHEN** a user installs the application from a supported mobile browser and later launches its home-screen icon
- **THEN** the application opens into the last available local application state without requiring a PC-hosted service

### Requirement: Stable Android WebView wrapper
The system SHALL provide an Android WebView packaging route for repeated personal phone testing that keeps the package identity and WebView storage origin stable across upgrades.

#### Scenario: Upgrade the WebView APK
- **WHEN** the user deploys a newer WebView APK over an existing install
- **THEN** the deployment uses the same `applicationId`, signing key, WebView asset origin, entry URL, and IndexedDB database name
- **AND** the install path uses an upgrade operation rather than uninstalling or clearing application data

#### Scenario: Load local assets through a stable HTTPS origin
- **WHEN** the WebView app starts
- **THEN** it loads bundled frontend assets through a fixed `https://appassets.androidplatform.net/app/index.html` entry rather than `file://` or `content://`
- **AND** browser storage APIs required by MobileChat, including IndexedDB, remain enabled inside that WebView

#### Scenario: Select images in the WebView wrapper
- **WHEN** the user activates an image file input inside the WebView app
- **THEN** the wrapper exposes Android's file chooser result back to the web page so the existing image attachment flow can run

#### Scenario: Enable Android immersive display from settings
- **WHEN** the user enables **沉浸显示（Android）** while running inside the Android WebView app
- **THEN** the native wrapper hides Android system bars and allows the WebView to extend into short-edge display cutout areas through its local JavaScript bridge
- **AND** desktop browsers, ordinary mobile browsers, and the local-file smoke route keep their normal browser or window chrome

### Requirement: Mobile-first navigation
The system SHALL provide mobile-accessible navigation between the conversation list, active conversation, assistant selection, archived conversations, and settings.

#### Scenario: Navigate on a narrow viewport
- **WHEN** the application is displayed on a phone-sized viewport
- **THEN** conversation management is available through a compact drawer or equivalent mobile control without obscuring the active chat permanently

#### Scenario: Open navigation after scrolling
- **WHEN** a user is reading a long conversation on a phone-sized viewport
- **THEN** a mobile-only floating control can open the conversation drawer without requiring the user to scroll back to the top header

### Requirement: Offline application shell
The system SHALL cache the static application shell and SHALL distinguish between offline application access and network-dependent chat operations.

#### Scenario: Open the application while offline
- **WHEN** a previously installed user opens the application without network connectivity
- **THEN** locally stored settings and conversations remain readable and chat sending is disabled with a clear offline indication

### Requirement: Dedicated settings surface
The system SHALL reserve a settings surface for API profiles, chat and utility assistants, context-summary rules, diagnostics and debug mode, data portability, appearance, composer input behavior, and future application options.

#### Scenario: Open settings from a conversation
- **WHEN** a user activates the settings control from the chat interface
- **THEN** the system opens the settings surface without deleting or replacing the active conversation

#### Scenario: Configure composer shortcuts
- **WHEN** a user changes the composer input shortcut setting
- **THEN** the setting persists locally and controls whether `Enter` sends or inserts a newline using concise **Enter 发送** / **Enter 换行** choices
- **AND** the non-selected action remains available through the control-key path, while desktop `Ctrl+J` inserts a newline without sending

#### Scenario: Keep settings compact and actionable
- **WHEN** the settings surface renders on a phone or a short desktop viewport
- **THEN** it prioritizes actionable controls over count-only status cards
- **AND** related context-summary controls such as summary assistant, raw-tail retention, and automatic interval can share compact rows when viewport width allows

#### Scenario: Align detail-panel actions
- **WHEN** a settings detail panel renders record actions such as enable, restore, add, delete, or probe
- **THEN** labels and controls use shared centered row alignment so compact desktop and phone layouts remain readable
- **AND** destructive actions remain visually associated with the record they affect

### Requirement: Developer debug mode
The system SHALL provide a settings toggle for debug mode that defaults off and, when enabled, exposes developer diagnostics for request context composition, token-budget estimates, provider usage, cache metrics, summary status, and adapter diagnostics.

#### Scenario: Enable debug diagnostics
- **WHEN** debug mode is enabled and a chat request completes
- **THEN** the active conversation can show the latest context budget report, pre-send cache estimate, normalized provider usage, observed cache read/write metrics when available, and unsupported/unknown markers for fields the provider did not return

#### Scenario: Redact credentials from diagnostics
- **WHEN** debug diagnostics render raw adapter or request metadata
- **THEN** API keys and authorization headers are redacted or omitted
