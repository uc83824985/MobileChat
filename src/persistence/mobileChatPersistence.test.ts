import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTEXT_SUMMARY_ASSISTANT_ID,
  createInitialSnapshot,
  defaultContextProfile,
  defaultContextSummaryFramework,
  defaultUtilityAssistantRefs,
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
    expect(snapshot.settings.utilityAssistantRefs).toEqual(
      defaultUtilityAssistantRefs,
    );
    expect(snapshot.settings.contextSummaryFramework.sections.length).toBe(
      defaultContextSummaryFramework.sections.length,
    );
    expect(
      snapshot.settings.contextSummaryFramework.sections.map(
        (section) => section.title,
      ),
    ).toEqual(["严格记忆", "精确事实", "模糊记忆", "探索记录", "当前状态"]);
    expect(snapshot.settings.contextProfiles).toEqual([defaultContextProfile]);
    expect(snapshot.settings.editingContextProfileId).toBe(
      defaultContextProfile.id,
    );
    expect(snapshot.settings.activeModelRef.modelId).toBe("default-model");
    expect(snapshot.apiProfiles).toHaveLength(1);
    expect(snapshot.apiProfiles[0]?.baseUrl).toBe("");
    expect(snapshot.apiProfiles[0]?.models).toHaveLength(1);
    expect(snapshot.assistants).toHaveLength(3);
    expect(snapshot.assistants.map((assistant) => assistant.id)).toContain(
      CONTEXT_SUMMARY_ASSISTANT_ID,
    );
    expect(
      snapshot.assistants.find((assistant) => assistant.id === "architect")
        ?.contextProfileId,
    ).toBe(defaultContextProfile.id);
    expect(snapshot.conversations[0]?.title).toBe("新对话 1");
    expect(snapshot.messages).toEqual([]);
  });

  it("does not reseed initial records over an existing empty database state", async () => {
    const snapshot = createInitialSnapshot();

    await replaceSnapshot({
      ...snapshot,
      apiProfiles: [],
      assistants: [],
      conversations: [],
      messages: [],
    });

    const restored = await loadSnapshot();

    expect(restored.apiProfiles).toEqual([]);
    expect(restored.assistants).toEqual([]);
    expect(restored.conversations).toEqual([]);
    expect(restored.messages).toEqual([]);
  });

  it("ignores old scalar context summary fields instead of migrating them", async () => {
    const snapshot = createInitialSnapshot();
    const oldShapeSnapshot = {
      ...snapshot,
      conversations: snapshot.conversations.map((conversation) =>
        conversation.id === "initial-conversation"
          ? {
              ...conversation,
              contextSummary: "old scalar summary",
              contextSummaryUpdatedAt: "2026-07-14T00:00:00.000Z",
              contextSummaryBoundaryMessageId: "m2",
              contextSummaryMessageCount: 2,
            }
          : conversation,
      ),
    } as unknown as LocalDataSnapshot;

    await replaceSnapshot(oldShapeSnapshot);
    const restored = await loadSnapshot();
    const conversation = restored.conversations.find(
      (candidate) => candidate.id === "initial-conversation",
    );

    expect(conversation?.activeContextSummaryId).toBeUndefined();
    expect(conversation?.contextSummaries).toBeUndefined();
    expect("contextSummary" in (conversation ?? {})).toBe(false);
  });

  it("normalizes summary framework to the current five dimensions", async () => {
    const snapshot = createInitialSnapshot();
    const snapshotWithExtraSections = {
      ...snapshot,
      settings: {
        ...snapshot.settings,
        contextSummaryFramework: {
          ...snapshot.settings.contextSummaryFramework,
          sections: [
            {
              id: "strict_memory",
              title: "严格记忆",
              instruction: "用户覆盖的严格记忆描述",
              required: true,
            },
            {
              id: "system_values",
              title: "系统数值",
              instruction: "旧系统数值描述",
              required: false,
            },
            {
              id: "persona_and_world",
              title: "人物与设定",
              instruction: "旧人物设定描述",
              required: false,
            },
          ],
        },
      },
    } as unknown as LocalDataSnapshot;

    await replaceSnapshot(snapshotWithExtraSections);
    const restored = await loadSnapshot();
    const sections = restored.settings.contextSummaryFramework.sections;

    expect(sections.map((section) => section.id)).toEqual([
      "strict_memory",
      "precise_facts",
      "fuzzy_memory",
      "exploration_log",
      "current_state",
    ]);
    expect(sections[0]?.instruction).toBe("用户覆盖的严格记忆描述");
    expect(sections.some((section) => section.id === "system_values")).toBe(
      false,
    );
    expect(sections.some((section) => section.id === "persona_and_world")).toBe(
      false,
    );
  });

  it("persists context profiles and assistant references", async () => {
    const snapshot = createInitialSnapshot();
    const profile = {
      id: "roleplay-context",
      name: "角色扮演上下文",
      description: "用于角色扮演分类。",
      dimensionOverrides: [
        {
          dimensionId: "fuzzy_memory",
          enabled: false,
          instruction: "记录关系温度、心情变化和共同经历。",
        },
      ],
    };
    const editedSnapshot: LocalDataSnapshot = {
      ...snapshot,
      settings: {
        ...snapshot.settings,
        contextProfiles: [defaultContextProfile, profile],
        editingContextProfileId: profile.id,
      },
      assistants: snapshot.assistants.map((assistant) =>
        assistant.id === "architect"
          ? { ...assistant, contextProfileId: profile.id }
          : assistant,
      ),
    };

    await saveSnapshot(editedSnapshot);
    const restored = await loadSnapshot();

    expect(restored.settings.editingContextProfileId).toBe(profile.id);
    expect(restored.settings.contextProfiles).toContainEqual(profile);
    expect(
      restored.assistants.find((assistant) => assistant.id === "architect")
        ?.contextProfileId,
    ).toBe(profile.id);
  });

  it("does not append missing built-in assistants based on old schema versions", async () => {
    const snapshot = createInitialSnapshot();
    const snapshotWithoutSummaryAssistant = {
      ...snapshot,
      settings: {
        ...snapshot.settings,
        schemaVersion: 7,
      },
      assistants: snapshot.assistants.filter(
        (assistant) => assistant.id !== CONTEXT_SUMMARY_ASSISTANT_ID,
      ),
    } as unknown as LocalDataSnapshot;

    await replaceSnapshot(snapshotWithoutSummaryAssistant);
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
        activeAssistantId: "architect",
        editingAssistantId: "architect",
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
                    }
                  : model,
              ),
            }
          : profile,
      ),
      assistants: snapshot.assistants.map((assistant) =>
        assistant.id === "architect"
          ? { ...assistant, name: "持久化默认助手" }
          : assistant,
      ),
    };

    await saveSnapshot(editedSnapshot);
    const restored = await loadSnapshot();

    expect(restored.settings.activeAssistantId).toBe("architect");
    expect(restored.settings.themeMode).toBe("light");
    expect(restored.settings.layoutMode).toBe("desktop");
    expect(restored.settings.streamingEnabled).toBe(false);
    expect(restored.settings.activeModelRef.modelId).toBe("default-model");
    expect(restored.apiProfiles[0]?.apiKey).toBe("local-only-key");
    const restoredModel = restored.apiProfiles[0]?.models.find(
      (model) => model.id === "default-model",
    );
    expect(restoredModel?.name).toBe("Persisted Model");
    expect(
      restored.assistants.find((assistant) => assistant.id === "research")
        ?.name,
    ).toBeUndefined();
    expect(
      restored.assistants.find((assistant) => assistant.id === "architect")
        ?.name,
    ).toBe("持久化默认助手");
  });

  it("uses current message timestamps without parsing old generated ids", async () => {
    const snapshot = createInitialSnapshot();
    const currentSnapshot = {
      ...snapshot,
      messages: [
        {
          id: "assistant-lvf9adyk-abcde",
          conversationId: "initial-conversation",
          role: "assistant",
          label: "助手",
          text: "old assistant",
          createdAt: "2026-07-14T00:00:02.000Z",
        },
        {
          id: "message-lvf9adxw-abcde",
          conversationId: "initial-conversation",
          role: "user",
          label: "用户",
          text: "old user",
          createdAt: "2026-07-14T00:00:01.000Z",
        },
      ],
    } as unknown as LocalDataSnapshot;

    await replaceSnapshot(currentSnapshot);
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
