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
The system SHALL support lightweight per-conversation `ContextSummary` records that replace older covered messages during request projection while preserving all canonical messages locally.

#### Scenario: Do not create a separate reduction feature
- **WHEN** the user configures built-in context management
- **THEN** the first-release settings expose context summary rather than a separate reduction assistant or reduction workflow
- **AND** context-size control is handled by the rolling summary, retained raw tail, and Context Profile summary budget

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

#### Scenario: Configure summary budget per context profile
- **WHEN** the user edits a Context Profile's summary character limit
- **THEN** future context-summary requests for chat assistants using that Profile include the limit as the target summary budget
- **AND** model definitions remain unchanged because they do not own scenario summary policy

#### Scenario: Disable a profile dimension
- **WHEN** the user disables a Context Profile dimension
- **THEN** that dimension is excluded from regular chat context injection and context-summary prompts
- **AND** any previously edited dimension guidance remains stored for preview and later re-enable but is not editable while disabled

#### Scenario: Create a context profile from agent standard output
- **WHEN** the user copies the Context Profile start prompt
- **THEN** the prompt explains the fixed five-section framework and asks an external agent to discuss a new purpose-specific Context Profile in natural language before exporting JSON
- **AND** the prompt instructs the external agent to keep the discussion convergent by giving one recommended direction, asking no more than three key clarification questions per turn, and avoiding large option menus unless the user explicitly asks for them
- **WHEN** the user later copies the export prompt and pastes an agent response containing a JSON configuration into the configuration parse area
- **THEN** the pasted standard output is autosaved as settings data before parsing
- **AND** the parser creates a new Context Profile using the parsed name, description, summary budget, enabled dimensions, and dimension guidance
- **AND** parsing does not overwrite the currently selected Context Profile, chat requests, or context-summary prompts
- **AND** the configuration parse area is cleared after either a successful or failed parse attempt

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

### Requirement: Summary display output
Each successful context-summary operation SHALL produce a continuation-oriented `contextSummary` for future model requests and may produce a concise `displaySummary` used only for history presentation and title/summary search.

#### Scenario: Search a summarized conversation
- **WHEN** a history query matches the display summary
- **THEN** the conversation is returned without indexing the longer context summary or historical message bodies

### Requirement: Summary validity follows the active path
The system SHALL use a summary only when its covered boundary is compatible with the conversation's current active leaf.

#### Scenario: Edit a message covered by the summary
- **WHEN** edit-and-resubmit or branch switching selects a path that diverges at or before the summary boundary
- **THEN** the summary is cleared or ignored for request construction until a new valid summary is generated

### Requirement: Summary failure isolation
Context-summary failures SHALL NOT fail, remove, rewrite, or roll back the completed chat response or the last valid summary.

#### Scenario: Summary output exceeds the configured budget
- **WHEN** a context-summary utility assistant returns text longer than the active Context Profile's summary character limit
- **THEN** the system may request one budget-rewrite attempt from the same utility assistant
- **AND** if the rewritten text is still empty or over budget, the system rejects the new summary and keeps the prior active summary unchanged

#### Scenario: Utility endpoint fails after a response
- **WHEN** the chat response is complete but the configured summary request fails
- **THEN** the conversation retains the completed response and prior summary and exposes a retryable summary error state

### Requirement: No cross-conversation memory
The context-summary system SHALL operate on exactly one conversation's active path and SHALL NOT create or query user-level, assistant-level, project-level, or cross-conversation memory.

#### Scenario: Summarize one of two conversations
- **WHEN** a utility assistant summarizes one conversation
- **THEN** neither the summary input nor its output includes messages or summaries from the other conversation
