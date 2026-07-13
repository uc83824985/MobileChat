# Mobile UI state

Date: 2026-07-13

## Current verified state

- The first mobile/desktop shell is usable as a local interaction prototype.
- Conversation creation, conversation selection, title/summary search, archive action, draft input, local placeholder send, stop generation, debug panel toggle, and settings open/close have been tested.
- The page is still a local React state prototype. It does not yet persist data to IndexedDB and does not call a real model endpoint.

## Feedback recorded

- Assistant selection must use an explicit dropdown. Cycling through assistants with a button is not usable enough on mobile.
- The settings page must not remain a placeholder. It must show the currently selected assistant and allow editing its configuration.
- Assistant configuration UI should behave like a UE-style reflected details panel: render fields from a schema/object shape rather than hard-code one specific assistant.
- The app should support editing arbitrary assistant objects, including newly added assistant objects, through the same details panel.

## Implemented response

- The chat header now uses a native assistant `<select>` so mobile browsers can use their own picker UI.
- Assistants are represented as editable objects with `name`, `description`, `kind`, `apiProfileName`, `model`, `prompt`, `initialMessage`, and `enabled`.
- Settings now includes an assistant selector, an add-assistant action, and a schema-rendered details panel for the selected assistant.
- Editing the active assistant updates the chat header and future local placeholder assistant message attribution immediately.

## Mobile feasibility

The operation is feasible on mobile with the current UI pattern:

- native select for assistant selection;
- full-screen settings panel on small screens;
- editable text inputs and textareas for assistant details;
- schema-rendered fields so new assistant fields can be added without creating a special page per assistant.

Current verification covers this with a Pixel-class Playwright viewport. Real-device testing should still be repeated after IndexedDB persistence and real API configuration are added.

## Remaining limitations

- No IndexedDB persistence yet; refresh loses runtime edits. The accepted next persistence target is a unified IndexedDB database named `MobileChatDB`.
- No real API profile/model CRUD yet.
- No credential handling or endpoint validation yet.
- Chat assistant vs. utility assistant enforcement is not complete in the prototype UI.
- Assistant snapshots are not yet copied onto persisted messages because persistence is not implemented.

## Persistence decision

- Configuration persistence, conversations, messages, checkpoints, drafts, and future blobs will use one versioned IndexedDB database: `MobileChatDB`.
- UI edits should update in-memory state immediately and persist asynchronously in the background.
- Text fields should debounce saves and flush on blur, settings close, send, and page visibility changes.
- Import/export must be designed together with persistence: `.mobilechat` archives export and import the same versioned record DTOs used by `MobileChatDB`, rather than copying browser database files.
