import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTEXT_SUMMARY_ASSISTANT_ID,
  createInitialSnapshot,
  type LocalDataSnapshot,
} from "../domain";
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
    expect(snapshot.settings.layoutMode).toBe("auto");
    expect(snapshot.settings.streamingEnabled).toBe(true);
    expect(snapshot.settings.activeModelRef.modelId).toBe("default-model");
    expect(snapshot.apiProfiles).toHaveLength(1);
    expect(snapshot.apiProfiles[0]?.baseUrl).toBe("");
    expect(snapshot.apiProfiles[0]?.models).toHaveLength(1);
    expect(snapshot.assistants).toHaveLength(4);
    expect(snapshot.assistants.map((assistant) => assistant.id)).toContain(
      CONTEXT_SUMMARY_ASSISTANT_ID,
    );
    expect(snapshot.conversations[0]?.title).toBe("本地上下文机制");
  });

  it("migrates the summary assistant once and respects later deletion", async () => {
    const snapshot = createInitialSnapshot();
    const legacySnapshot = {
      ...snapshot,
      settings: {
        ...snapshot.settings,
        schemaVersion: 7,
      },
      assistants: snapshot.assistants.filter(
        (assistant) => assistant.id !== CONTEXT_SUMMARY_ASSISTANT_ID,
      ),
    } as unknown as LocalDataSnapshot;

    await replaceSnapshot(legacySnapshot);
    const migrated = await loadSnapshot();
    expect(migrated.assistants.map((assistant) => assistant.id)).toContain(
      CONTEXT_SUMMARY_ASSISTANT_ID,
    );

    await saveSnapshot({
      ...migrated,
      assistants: migrated.assistants.filter(
        (assistant) => assistant.id !== CONTEXT_SUMMARY_ASSISTANT_ID,
      ),
    });
    const restored = await loadSnapshot();
    expect(restored.assistants.map((assistant) => assistant.id)).not.toContain(
      CONTEXT_SUMMARY_ASSISTANT_ID,
    );
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
        layoutMode: "desktop",
        streamingEnabled: false,
        activeModelRef: {
          apiProfileId: "default-profile",
          modelId: "default-model",
        },
      },
      apiProfiles: snapshot.apiProfiles.map((profile) =>
        profile.id === "default-profile"
          ? {
              ...profile,
              apiKey: "local-only-key",
              models: profile.models.map((model) =>
                model.id === "default-model"
                  ? {
                      ...model,
                      name: "Persisted Model",
                      webSearchEnabled: true,
                    }
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
    expect(restored.settings.layoutMode).toBe("desktop");
    expect(restored.settings.streamingEnabled).toBe(false);
    expect(restored.settings.activeModelRef.modelId).toBe("default-model");
    expect(restored.apiProfiles[0]?.apiKey).toBe("local-only-key");
    const restoredModel = restored.apiProfiles[0]?.models.find(
      (model) => model.id === "default-model",
    );
    expect(restoredModel?.name).toBe("Persisted Model");
    expect("webSearchEnabled" in (restoredModel ?? {})).toBe(false);
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
