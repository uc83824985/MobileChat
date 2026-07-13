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

### Requirement: Configurable automatic summary rules
The system SHALL allow summary automation to be enabled or disabled and configured by minimum completed turns, update interval in completed turns, target API-profile model reference, prompt template, and maximum summary length.

#### Scenario: Update after the configured number of turns
- **WHEN** an enabled conversation reaches the next configured completed-turn threshold
- **THEN** the system initiates a summary update after the assistant response completes without relying on a background timer

### Requirement: Incremental summary state
The system SHALL record the message boundary and completed-turn count represented by the current summary so subsequent updates can combine the prior summary with only newer conversation content.

#### Scenario: Incrementally refresh a summary
- **WHEN** a summary already covers an earlier message boundary and another update is triggered
- **THEN** the summarization request includes the prior summary and messages after that boundary and advances the boundary only after a successful update

### Requirement: Summary failure isolation
Summary generation failures SHALL NOT fail, remove, or roll back the completed chat response that triggered the summary attempt.

#### Scenario: Summary endpoint fails after a response
- **WHEN** the chat response is complete but the configured summary request fails
- **THEN** the conversation retains the completed response and previous summary and exposes a retryable summary error state

### Requirement: Manual summary refresh
The system SHALL allow a user to request an immediate summary refresh using the configured summary rules and model reference.

#### Scenario: Refresh before the automatic threshold
- **WHEN** a user requests a manual summary update before the next automatic threshold
- **THEN** the system attempts the update immediately and records the new summary boundary upon success
