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
    expect(snapshot.settings.themeMode).toBe("system");
    expect(snapshot.settings.streamingEnabled).toBe(true);
    expect(snapshot.settings.activeModelRef.modelId).toBe("gpt-5.4-codex-high");
    expect(snapshot.apiProfiles).toHaveLength(1);
    expect(snapshot.apiProfiles[0]?.models.length).toBeGreaterThan(1);
    expect(snapshot.assistants).toHaveLength(3);
    expect(snapshot.conversations[0]?.title).toBe("本地上下文机制");
  });

  it("persists assistant, model, and active settings edits", async () => {
    const snapshot = createInitialSnapshot();
    const editedSnapshot: LocalDataSnapshot = {
      ...snapshot,
      settings: {
        ...snapshot.settings,
        activeAssistantId: "research",
        editingAssistantId: "research",
        themeMode: "light",
        streamingEnabled: false,
        activeModelRef: {
          apiProfileId: "mnapi",
          modelId: "gpt-5.4-mini",
        },
      },
      apiProfiles: snapshot.apiProfiles.map((profile) =>
        profile.id === "mnapi"
          ? {
              ...profile,
              apiKey: "local-only-key",
              models: profile.models.map((model) =>
                model.id === "gpt-5.4-mini"
                  ? { ...model, name: "Mini Persisted" }
                  : model,
              ),
            }
          : profile,
      ),
      assistants: snapshot.assistants.map((assistant) =>
        assistant.id === "research"
          ? { ...assistant, name: "持久化研究助手" }
          : assistant,
      ),
    };

    await saveSnapshot(editedSnapshot);
    const restored = await loadSnapshot();

    expect(restored.settings.activeAssistantId).toBe("research");
    expect(restored.settings.themeMode).toBe("light");
    expect(restored.settings.streamingEnabled).toBe(false);
    expect(restored.settings.activeModelRef.modelId).toBe("gpt-5.4-mini");
    expect(restored.apiProfiles[0]?.apiKey).toBe("local-only-key");
    expect(
      restored.apiProfiles[0]?.models.find(
        (model) => model.id === "gpt-5.4-mini",
      )?.name,
    ).toBe("Mini Persisted");
    expect(
      restored.assistants.find((assistant) => assistant.id === "research")
        ?.name,
    ).toBe("持久化研究助手");
  });

  it("migrates legacy messages with timestamp-like ids into createdAt order", async () => {
    const snapshot = createInitialSnapshot();
    const legacySnapshot = {
      ...snapshot,
      messages: [
        {
          id: "assistant-lvf9adyk-abcde",
          conversationId: "local-context",
          role: "assistant",
          label: "助手",
          text: "old assistant",
        },
        {
          id: "message-lvf9adxw-abcde",
          conversationId: "local-context",
          role: "user",
          label: "用户",
          text: "old user",
        },
      ],
    } as unknown as LocalDataSnapshot;

    await replaceSnapshot(legacySnapshot);
    const restored = await loadSnapshot();
    const restoredMessages = restored.messages.toSorted((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );

    expect(restoredMessages[0]?.text).toBe("old user");
    expect(restoredMessages[1]?.text).toBe("old assistant");
    expect(restoredMessages.every((message) => message.createdAt)).toBe(true);
  });

  it("round-trips a credential-free .mobilechat archive and replaces local data", async () => {
    const snapshot = createInitialSnapshot();
    const exportedSnapshot: LocalDataSnapshot = {
      ...snapshot,
      apiProfiles: snapshot.apiProfiles.map((profile) => ({
        ...profile,
        apiKey: "should-not-export",
      })),
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

    expect(restored.apiProfiles[0]?.apiKey).toBe("");
    expect(
      restored.assistants.find((assistant) => assistant.id === "architect")
        ?.name,
    ).toBe("导出助手");
  });
});
