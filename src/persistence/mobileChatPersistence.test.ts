import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createInitialSnapshot, type LocalDataSnapshot } from "../domain";
import {
  createMobileChatArchive,
  readMobileChatArchive,
} from "./mobileChatArchive";
import {
  deleteMobileChatDb,
  loadSnapshot,
  replaceSnapshot,
  saveSnapshot,
} from "./mobileChatDb";

afterEach(async () => {
  await deleteMobileChatDb();
});

describe("MobileChat persistence", () => {
  it("seeds MobileChatDB on first load", async () => {
    const snapshot = await loadSnapshot();

    expect(snapshot.settings.activeAssistantId).toBe("architect");
    expect(snapshot.assistants).toHaveLength(3);
    expect(snapshot.conversations[0]?.title).toBe("本地上下文机制");
  });

  it("persists assistant edits and active settings", async () => {
    const snapshot = createInitialSnapshot();
    const editedSnapshot: LocalDataSnapshot = {
      ...snapshot,
      settings: {
        ...snapshot.settings,
        activeAssistantId: "research",
        editingAssistantId: "research",
      },
      assistants: snapshot.assistants.map((assistant) =>
        assistant.id === "research"
          ? { ...assistant, name: "持久化研究助手" }
          : assistant,
      ),
    };

    await saveSnapshot(editedSnapshot);
    const restored = await loadSnapshot();

    expect(restored.settings.activeAssistantId).toBe("research");
    expect(
      restored.assistants.find((assistant) => assistant.id === "research")
        ?.name,
    ).toBe("持久化研究助手");
  });

  it("round-trips a .mobilechat archive and replaces local data", async () => {
    const snapshot = createInitialSnapshot();
    const exportedSnapshot: LocalDataSnapshot = {
      ...snapshot,
      assistants: snapshot.assistants.map((assistant) =>
        assistant.id === "architect"
          ? { ...assistant, name: "导出助手" }
          : assistant,
      ),
    };

    const archive = await createMobileChatArchive(exportedSnapshot, {
      includeCredentials: false,
    });
    const importedSnapshot = await readMobileChatArchive(archive);

    await replaceSnapshot(importedSnapshot);
    const restored = await loadSnapshot();

    expect(
      restored.assistants.find((assistant) => assistant.id === "architect")
        ?.name,
    ).toBe("导出助手");
  });
});
