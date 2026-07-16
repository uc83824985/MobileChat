## ADDED Requirements

### Requirement: Current conversation content search
The system SHALL provide fuzzy search over searchable text content parts in the currently open conversation, including result count, highlighting, and previous/next navigation.

#### Scenario: Navigate matching messages
- **WHEN** a search query fuzzily matches multiple current-conversation messages
- **THEN** the system highlights the active match and allows the user to move between matched messages in conversation order

### Requirement: Metadata-only history search
The system SHALL search historical conversations using only their user-defined titles and stored summaries and SHALL NOT scan message bodies from other conversations.

#### Scenario: Match a historical summary
- **WHEN** a query fuzzily matches a conversation summary but none of its title text
- **THEN** the conversation appears in history results with a title and matching summary excerpt

#### Scenario: Ignore matching historical message text
- **WHEN** a query matches only the body of a message in a non-active conversation
- **THEN** that conversation is not returned unless the query also matches its title or summary

### Requirement: Manual lightweight context summary
The system SHALL support lightweight per-conversation `ContextSummary` records that are separate from immutable context compaction checkpoints and can replace older covered messages during request projection while preserving all canonical messages locally.

#### Scenario: Generate a debug context summary
- **WHEN** debug mode is enabled and the user invokes the manual context-summary action
- **THEN** the system calls the global utility assistant referenced by the context-summary feature setting in the foreground, applies the active chat assistant's Context Profile, stores the resulting active rolling summary in `contextSummaries[]` with boundary, count, timestamp, framework snapshot, Context Profile snapshot, and source snapshot metadata, and does not append a visible chat message

#### Scenario: Configure raw tail retention
- **WHEN** the user changes the context-summary raw-tail retention setting
- **THEN** future context-summary records use that local setting to decide how many newest raw messages remain outside the summary boundary
- **AND** the setting defaults to 8 and is clamped to a small non-negative range suitable for local context projection

#### Scenario: Generate a debug summary below the raw-tail threshold
- **WHEN** debug mode is enabled and the conversation has at least one completed text message but fewer messages than the normal raw-tail retention threshold
- **THEN** the manual context-summary action still executes after showing a local warning/status instead of being blocked by the threshold

#### Scenario: Auto summarize after a completed-message interval
- **WHEN** automatic context summary is enabled with a positive message interval
- **AND** a chat, retry, or regenerate response completes with at least that many completed text messages after the active summary boundary
- **THEN** the system starts a non-blocking context-summary job using the trigger-time message snapshot
- **AND** the visible conversation remains unchanged and the user may continue chatting while the summary job is running
- **AND** messages added after the trigger snapshot remain unsummarized raw tail until a later trigger

#### Scenario: Auto summary reuses the previous rolling summary
- **WHEN** a valid active `ContextSummary` exists and its boundary message is still present
- **AND** a later automatic or manual summary advances the boundary
- **THEN** the summary request includes the previous summary plus only raw messages after the previous boundary up to the new trigger boundary
- **AND** the resulting active rolling summary stores the previous summary ID for provenance

#### Scenario: Configure summary framework sections
- **WHEN** the system calls a context-summary utility assistant
- **THEN** the request includes the locally configured summary framework, including section names and instructions, so the assistant fills a stable structure rather than inventing categories
- **AND** the default framework uses five orthogonal sections: strict memory, precise facts, fuzzy memory, exploration log, and current state

#### Scenario: Override summary framework descriptions
- **WHEN** the user edits a summary-framework section description in Settings
- **THEN** future context-summary requests use the overridden description for that fixed section
- **AND** the user can restore either that section or the full framework back to system defaults without changing section IDs, titles, or order

#### Scenario: Configure feature assistant reference
- **WHEN** the user changes the built-in context-summary assistant setting
- **THEN** future manual summaries use that referenced enabled utility assistant instead of inferring behavior from utility kind alone

#### Scenario: Configure chat assistant context profile
- **WHEN** the user edits a Context Profile in Settings and assigns it to a chat assistant
- **THEN** regular chat requests and future context-summary requests include that Profile's per-dimension guidance while preserving the fixed five-section framework
- **AND** the system does not require a separate summary utility assistant for each chat assistant

#### Scenario: Disable a profile dimension
- **WHEN** the user disables a Context Profile dimension
- **THEN** that dimension is excluded from regular chat context injection and context-summary prompts
- **AND** any previously edited dimension guidance remains stored for preview and later re-enable but is not editable while disabled

#### Scenario: Preview the current summary
- **WHEN** a valid `ContextSummary` exists and debug mode is enabled
- **THEN** the system provides a local preview action that displays the stored summary without making a provider request

#### Scenario: Inspect summary projection diff
- **WHEN** debug mode is enabled and the user opens the read-only data inspector
- **THEN** the system displays the active conversation record, current summary metadata, messages covered by the summary boundary, retained raw tail messages, next-request projected messages, and read-only JSON data
- **AND** the inspector does not mutate conversations, messages, settings, or IndexedDB records

#### Scenario: Use summary in the next request
- **WHEN** a valid `ContextSummary` covers older messages
- **THEN** the next assistant request includes the summary plus recent raw tail messages instead of sending both the summary and all covered raw messages

#### Scenario: Keep title out of semantic summary
- **WHEN** the system asks the context-summary utility assistant to summarize a conversation
- **THEN** the request may include the title and list summary only as positioning metadata
- **AND** the prompt instructs the utility assistant not to write those metadata fields into the semantic summary body unless the user explicitly discusses the metadata itself as a business fact

#### Scenario: Covered message is deleted
- **WHEN** the user deletes a message that is inside the current summary boundary
- **THEN** the system clears that conversation's `ContextSummary` before later request construction

### Requirement: Configurable context-compaction policy
The system SHALL allow foreground context compaction to be enabled or disabled and configured by a context-compression utility-assistant reference, minimum completed turns, completed-turn interval, optional estimated-input-token threshold, recent turns retained verbatim, and output-length limits.

#### Scenario: Compact after a completed-turn threshold
- **WHEN** an enabled conversation reaches the next configured completed-turn threshold
- **THEN** the system starts a compaction attempt after the chat response completes without relying on a background timer

#### Scenario: Compact before approaching the model context limit
- **WHEN** the locally estimated projected input reaches the configured compaction threshold
- **THEN** the system requests foreground compaction before silently omitting any active-path message

### Requirement: Utility assistant reference for compaction
The system SHALL run semantic context compaction through a configured enabled utility assistant whose role is `context-compression`, using that assistant's own prompt and selected model binding.

#### Scenario: Compression assistant is unavailable
- **WHEN** the referenced utility assistant or model binding is disabled, deleted, or unresolved
- **THEN** automatic compaction is paused, the existing checkpoint remains usable, and the settings UI requires a valid replacement without falling back to the active chat assistant silently

### Requirement: Incremental immutable context checkpoints
The system SHALL store immutable context checkpoints that include a continuation summary, display summary, covered active-path message boundary, completed-turn count, prior-checkpoint reference, revision, timestamps, and an immutable snapshot of the utility assistant and model used.

#### Scenario: Incrementally compact a conversation
- **WHEN** a valid checkpoint covers an earlier boundary and another compaction is triggered
- **THEN** the compaction request combines the prior continuation summary with only active-path messages after that boundary up to the new cutoff and preserves the configured recent tail verbatim

#### Scenario: Commit a successful checkpoint
- **WHEN** the utility result passes format and reference validation
- **THEN** the system atomically stores the checkpoint, updates the conversation's active checkpoint reference and display summary, and leaves canonical messages unchanged

### Requirement: Dual summary output
Each successful compaction SHALL produce a continuation-oriented `contextSummary` for future model requests and a concise `displaySummary` used only for history presentation and title/summary search.

#### Scenario: Search a compacted conversation
- **WHEN** a history query matches the display summary
- **THEN** the conversation is returned without indexing the longer context summary or historical message bodies

### Requirement: Checkpoint validity follows the active path
The system SHALL use a checkpoint only when its covered boundary is an ancestor of the conversation's current active leaf.

#### Scenario: Edit a message covered by the checkpoint
- **WHEN** edit-and-resubmit or branch switching selects a path that diverges at or before the checkpoint boundary
- **THEN** the checkpoint is marked invalid for the active path and no longer contributes to request construction

### Requirement: Compaction failure isolation
Compaction failures SHALL NOT fail, remove, rewrite, or roll back the completed chat response or the last valid checkpoint.

#### Scenario: Utility endpoint fails after a response
- **WHEN** the chat response is complete but the configured compaction request fails
- **THEN** the conversation retains the completed response and prior checkpoint and exposes a retryable compaction error state

### Requirement: Manual compact action
The system SHALL provide a visible **Compact context** action that immediately invokes the configured compaction policy in the foreground, analogous to a `/compact` command.

#### Scenario: Compact before the automatic threshold
- **WHEN** a user requests manual compaction before the next automatic threshold
- **THEN** the system attempts compaction immediately and advances the checkpoint boundary only after successful validation and commit

### Requirement: No cross-conversation memory
The compaction system SHALL operate on exactly one conversation's active path and SHALL NOT create or query user-level, assistant-level, project-level, or cross-conversation memory.

#### Scenario: Compact one of two conversations
- **WHEN** a utility assistant compacts one conversation
- **THEN** neither the compaction input nor its output includes messages or checkpoints from the other conversation
