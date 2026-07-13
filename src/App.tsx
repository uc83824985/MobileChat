import {
  Archive,
  Bot,
  Check,
  Database,
  Download,
  KeyRound,
  MessageSquarePlus,
  Palette,
  PanelLeft,
  Pencil,
  Plus,
  Search,
  Send,
  Server,
  Settings,
  SlidersHorizontal,
  StopCircle,
  Upload,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  useCallback,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { requestResponsesChat } from "./api/responsesClient";
import "./App.css";
import {
  type ApiProfile,
  type Assistant,
  type AssistantFieldKey,
  type AssistantModelBinding,
  assistantFields,
  type Conversation,
  createId,
  createInitialSnapshot,
  DEFAULT_MODEL_REF,
  defaultAssistant,
  type LocalDataSnapshot,
  type Message,
  type ModelDefinition,
  type ModelRef,
  modelRefKey,
  parseModelRefKey,
  type ResponseUsage,
  type SaveStatus,
  type StorageInfo,
  type ThemeMode,
} from "./domain";
import {
  createArchiveDownloadName,
  createMobileChatArchive,
  estimateArchiveSizeText,
  readMobileChatArchive,
} from "./persistence/mobileChatArchive";
import {
  loadSnapshot,
  replaceSnapshot,
  requestStorageInfo,
  saveSnapshot,
  updateLastSuccessfulExport,
} from "./persistence/mobileChatDb";

type PwaNotice = "offline-ready" | "update-available" | null;
type ResolvedModel = {
  apiProfile: ApiProfile;
  model: ModelDefinition;
  ref: ModelRef;
  key: string;
};

const bootSnapshot = createInitialSnapshot();
const AUTOSAVE_DELAY_MS = 400;

const themeLabels: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "亮色",
  dark: "暗色",
};

const saveStatusLabels: Record<SaveStatus, string> = {
  loading: "加载中",
  unsaved: "未保存",
  saving: "保存中",
  saved: "已保存",
  failed: "保存失败",
};

const cloneModelRef = (ref: ModelRef): ModelRef => ({
  apiProfileId: ref.apiProfileId,
  modelId: ref.modelId,
});

const resolveModel = (
  apiProfiles: ApiProfile[],
  ref: ModelRef,
): ResolvedModel | undefined => {
  const apiProfile = apiProfiles.find(
    (profile) => profile.id === ref.apiProfileId,
  );
  const model = apiProfile?.models.find(
    (candidate) => candidate.id === ref.modelId,
  );

  if (!apiProfile || !model) {
    return undefined;
  }

  return {
    apiProfile,
    model,
    ref: cloneModelRef(ref),
    key: modelRefKey(ref),
  };
};

const listAllModels = (apiProfiles: ApiProfile[]) =>
  apiProfiles.flatMap((apiProfile) =>
    apiProfile.models.map((model) => ({
      apiProfile,
      model,
      ref: { apiProfileId: apiProfile.id, modelId: model.id },
      key: modelRefKey({ apiProfileId: apiProfile.id, modelId: model.id }),
    })),
  );

const createBinding = (
  apiProfile: ApiProfile,
  model: ModelDefinition,
  isDefault: boolean,
): AssistantModelBinding => ({
  apiProfileId: apiProfile.id,
  modelId: model.id,
  enabled: true,
  isDefault,
  apiProfileNameSnapshot: apiProfile.name,
  modelNameSnapshot: model.name,
  modelDescriptionSnapshot: model.description,
});

const listAssistantModels = (
  assistant: Assistant,
  apiProfiles: ApiProfile[],
): ResolvedModel[] =>
  assistant.modelBindings
    .filter((binding) => binding.enabled)
    .map((binding) => resolveModel(apiProfiles, binding))
    .filter((model): model is ResolvedModel => Boolean(model))
    .filter(({ apiProfile, model }) => apiProfile.enabled && model.enabled);

const chooseModelForAssistant = (
  assistant: Assistant,
  currentRef: ModelRef,
  apiProfiles: ApiProfile[],
): ModelRef => {
  const available = listAssistantModels(assistant, apiProfiles);

  if (available.some((option) => option.key === modelRefKey(currentRef))) {
    return currentRef;
  }

  const defaultBinding = assistant.modelBindings.find(
    (binding) => binding.enabled && binding.isDefault,
  );
  if (defaultBinding) {
    const resolvedDefault = resolveModel(apiProfiles, defaultBinding);
    if (resolvedDefault?.apiProfile.enabled && resolvedDefault.model.enabled) {
      return resolvedDefault.ref;
    }
  }

  return available[0]?.ref ?? DEFAULT_MODEL_REF;
};

const estimateTokenCount = (messages: Message[], draft = "") => {
  const textLength =
    messages.reduce((sum, message) => sum + message.text.length, 0) +
    draft.length;
  return Math.max(1, Math.ceil(textLength / 2));
};

const formatObservedUsage = (usage?: ResponseUsage) => {
  if (
    !usage ||
    typeof usage.inputTokens !== "number" ||
    usage.inputTokens <= 0
  ) {
    return "unknown";
  }

  const output = usage.outputTokens ?? 0;
  const total = usage.totalTokens ?? usage.inputTokens + output;
  const cached = usage.cachedInputTokens;
  const cacheLabel =
    typeof cached === "number"
      ? `cache ${cached}/${usage.inputTokens}`
      : "cache unknown";

  return `in ${usage.inputTokens} / out ${output} / total ${total} · ${cacheLabel}`;
};

const formatStorageUsage = (storageInfo: StorageInfo) => {
  if (
    typeof storageInfo.usage !== "number" ||
    typeof storageInfo.quota !== "number"
  ) {
    return "unknown";
  }

  return `${(storageInfo.usage / 1024).toFixed(1)} KB / ${(
    storageInfo.quota /
    1024 /
    1024
  ).toFixed(1)} MB`;
};

const createSourceSnapshot = (
  assistant: Assistant,
  resolvedModel: ResolvedModel,
) => ({
  assistantId: assistant.id,
  assistantName: assistant.name,
  assistantDescription: assistant.description,
  apiProfileId: resolvedModel.apiProfile.id,
  apiProfileName: resolvedModel.apiProfile.name,
  modelId: resolvedModel.model.id,
  modelName: resolvedModel.model.name,
  modelDescription: resolvedModel.model.description,
});

function App() {
  const [apiProfiles, setApiProfiles] = useState<ApiProfile[]>(
    bootSnapshot.apiProfiles,
  );
  const [conversations, setConversations] = useState<Conversation[]>(
    bootSnapshot.conversations,
  );
  const [messages, setMessages] = useState<Message[]>(bootSnapshot.messages);
  const [assistants, setAssistants] = useState<Assistant[]>(
    bootSnapshot.assistants,
  );
  const [activeConversationId, setActiveConversationId] = useState(
    bootSnapshot.settings.activeConversationId,
  );
  const [activeAssistantId, setActiveAssistantId] = useState(
    bootSnapshot.settings.activeAssistantId,
  );
  const [activeModelRef, setActiveModelRef] = useState<ModelRef>(
    bootSnapshot.settings.activeModelRef,
  );
  const [editingAssistantId, setEditingAssistantId] = useState(
    bootSnapshot.settings.editingAssistantId,
  );
  const [editingApiProfileId, setEditingApiProfileId] = useState(
    bootSnapshot.apiProfiles[0]?.id ?? DEFAULT_MODEL_REF.apiProfileId,
  );
  const [editingModelId, setEditingModelId] = useState(
    bootSnapshot.apiProfiles[0]?.models[0]?.id ?? DEFAULT_MODEL_REF.modelId,
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    bootSnapshot.settings.themeMode,
  );
  const [streamingEnabled, setStreamingEnabled] = useState(
    bootSnapshot.settings.streamingEnabled,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(
    bootSnapshot.settings.debugEnabled,
  );
  const [draft, setDraft] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [editingTitleConversationId, setEditingTitleConversationId] = useState<
    string | null
  >(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [saveError, setSaveError] = useState("");
  const [lastSuccessfulExportAt, setLastSuccessfulExportAt] = useState(
    bootSnapshot.settings.lastSuccessfulExportAt,
  );
  const [storageInfo, setStorageInfo] = useState<StorageInfo>({
    persisted: bootSnapshot.settings.storagePersisted ?? null,
    usage: bootSnapshot.settings.storageUsage,
    quota: bootSnapshot.settings.storageQuota,
  });
  const [archiveSizeText, setArchiveSizeText] = useState("估算中");
  const [backupMessage, setBackupMessage] = useState("");
  const [lastObservedUsage, setLastObservedUsage] = useState<
    ResponseUsage | undefined
  >();
  const [pwaNotice, setPwaNotice] = useState<PwaNotice>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const latestSnapshotRef = useRef<LocalDataSnapshot>(bootSnapshot);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const activeAssistant = useMemo(
    () =>
      assistants.find((assistant) => assistant.id === activeAssistantId) ??
      assistants[0] ??
      defaultAssistant,
    [activeAssistantId, assistants],
  );
  const editingAssistant = useMemo(
    () =>
      assistants.find((assistant) => assistant.id === editingAssistantId) ??
      activeAssistant,
    [activeAssistant, editingAssistantId, assistants],
  );
  const editingApiProfile = useMemo(
    () =>
      apiProfiles.find((profile) => profile.id === editingApiProfileId) ??
      apiProfiles[0],
    [apiProfiles, editingApiProfileId],
  );
  const editingModel = useMemo(
    () =>
      editingApiProfile?.models.find((model) => model.id === editingModelId) ??
      editingApiProfile?.models[0],
    [editingApiProfile, editingModelId],
  );
  const activeConversation = useMemo(
    () =>
      conversations.find(
        (conversation) => conversation.id === activeConversationId,
      ) ?? conversations.find((conversation) => !conversation.archived),
    [activeConversationId, conversations],
  );
  const activeMessages = useMemo(
    () =>
      messages.filter(
        (message) => message.conversationId === activeConversation?.id,
      ),
    [activeConversation?.id, messages],
  );
  const activeResolvedModel = useMemo(
    () => resolveModel(apiProfiles, activeModelRef),
    [activeModelRef, apiProfiles],
  );
  const assistantModelOptions = useMemo(
    () => listAssistantModels(activeAssistant, apiProfiles),
    [activeAssistant, apiProfiles],
  );
  const allModelOptions = useMemo(
    () => listAllModels(apiProfiles),
    [apiProfiles],
  );
  const visibleConversations = useMemo(() => {
    const keyword = conversationSearch.trim().toLocaleLowerCase();

    return conversations.filter((conversation) => {
      if (conversation.archived) {
        return false;
      }
      if (!keyword) {
        return true;
      }

      return `${conversation.title} ${conversation.summary}`
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [conversationSearch, conversations]);

  const chatAssistantCount = assistants.filter(
    (assistant) => assistant.kind === "chat",
  ).length;
  const utilityAssistantCount = assistants.filter(
    (assistant) => assistant.kind === "utility",
  ).length;
  const diagnostics = useMemo(
    () => [
      ["输入估算", `${estimateTokenCount(activeMessages, draft)} tokens`],
      [
        "可缓存前缀估算",
        activeMessages.length > 2
          ? "high"
          : activeMessages.length > 0
            ? "low"
            : "0%",
      ],
      ["发送前预算", activeResolvedModel?.model.name ?? "未选择模型"],
      ["发送后 usage", formatObservedUsage(lastObservedUsage)],
    ],
    [activeMessages, activeResolvedModel?.model.name, draft, lastObservedUsage],
  );
  const appSettings = useMemo(
    () => ({
      ...bootSnapshot.settings,
      activeConversationId,
      activeAssistantId,
      activeModelRef,
      editingAssistantId,
      themeMode,
      streamingEnabled,
      debugEnabled,
      lastSuccessfulExportAt,
      storagePersisted: storageInfo.persisted,
      storageUsage: storageInfo.usage,
      storageQuota: storageInfo.quota,
    }),
    [
      activeAssistantId,
      activeConversationId,
      activeModelRef,
      debugEnabled,
      editingAssistantId,
      lastSuccessfulExportAt,
      streamingEnabled,
      storageInfo.persisted,
      storageInfo.quota,
      storageInfo.usage,
      themeMode,
    ],
  );
  const currentSnapshot = useMemo<LocalDataSnapshot>(
    () => ({
      settings: appSettings,
      apiProfiles,
      assistants,
      conversations,
      messages,
    }),
    [apiProfiles, appSettings, assistants, conversations, messages],
  );

  const applySnapshot = useCallback((snapshot: LocalDataSnapshot) => {
    setApiProfiles(snapshot.apiProfiles);
    setAssistants(snapshot.assistants);
    setConversations(snapshot.conversations);
    setMessages(snapshot.messages);
    setActiveConversationId(snapshot.settings.activeConversationId);
    setActiveAssistantId(snapshot.settings.activeAssistantId);
    setActiveModelRef(snapshot.settings.activeModelRef);
    setEditingAssistantId(snapshot.settings.editingAssistantId);
    setEditingApiProfileId(
      snapshot.apiProfiles[0]?.id ?? DEFAULT_MODEL_REF.apiProfileId,
    );
    setEditingModelId(
      snapshot.apiProfiles[0]?.models[0]?.id ?? DEFAULT_MODEL_REF.modelId,
    );
    setThemeMode(snapshot.settings.themeMode);
    setStreamingEnabled(snapshot.settings.streamingEnabled);
    setDebugEnabled(snapshot.settings.debugEnabled);
    setLastSuccessfulExportAt(snapshot.settings.lastSuccessfulExportAt);
    setStorageInfo({
      persisted: snapshot.settings.storagePersisted ?? null,
      usage: snapshot.settings.storageUsage,
      quota: snapshot.settings.storageQuota,
    });
  }, []);

  const saveCurrentSnapshot = useCallback(
    async (snapshot = latestSnapshotRef.current) => {
      setSaveStatus("saving");
      setSaveError("");

      try {
        await saveSnapshot(snapshot);
        setSaveStatus("saved");
      } catch (error) {
        setSaveStatus("failed");
        setSaveError(
          error instanceof Error ? error.message : "保存到 MobileChatDB 失败",
        );
      }
    },
    [],
  );

  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === "system") {
      root.removeAttribute("data-theme");
      root.style.colorScheme = "light dark";
      return;
    }

    root.dataset.theme = themeMode;
    root.style.colorScheme = themeMode;
  }, [themeMode]);

  useEffect(() => {
    const showOfflineReady = () => setPwaNotice("offline-ready");
    const showUpdateAvailable = () => setPwaNotice("update-available");

    window.addEventListener("mobilechat:pwa-offline-ready", showOfflineReady);
    window.addEventListener(
      "mobilechat:pwa-update-available",
      showUpdateAvailable,
    );

    return () => {
      window.removeEventListener(
        "mobilechat:pwa-offline-ready",
        showOfflineReady,
      );
      window.removeEventListener(
        "mobilechat:pwa-update-available",
        showUpdateAvailable,
      );
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      try {
        const snapshot = await loadSnapshot();
        if (cancelled) {
          return;
        }

        applySnapshot(snapshot);
        latestSnapshotRef.current = snapshot;
        setHydrated(true);
        setSaveStatus("saved");

        const nextStorageInfo = await requestStorageInfo();
        if (!cancelled) {
          setStorageInfo(nextStorageInfo);
        }
      } catch (error) {
        if (!cancelled) {
          setHydrated(true);
          setSaveStatus("failed");
          setSaveError(
            error instanceof Error ? error.message : "加载 MobileChatDB 失败",
          );
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [applySnapshot]);

  useEffect(() => {
    latestSnapshotRef.current = currentSnapshot;
  }, [currentSnapshot]);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    setSaveStatus("unsaved");
    setSaveError("");

    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = window.setTimeout(() => {
      void saveCurrentSnapshot(currentSnapshot);
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [currentSnapshot, hydrated, saveCurrentSnapshot]);

  useEffect(() => {
    const selectedRef = chooseModelForAssistant(
      activeAssistant,
      activeModelRef,
      apiProfiles,
    );
    if (modelRefKey(selectedRef) !== modelRefKey(activeModelRef)) {
      setActiveModelRef(selectedRef);
    }
  }, [activeAssistant, activeModelRef, apiProfiles]);

  useEffect(() => {
    if (!editingApiProfile && apiProfiles[0]) {
      setEditingApiProfileId(apiProfiles[0].id);
      setEditingModelId(apiProfiles[0].models[0]?.id ?? "");
    }
  }, [apiProfiles, editingApiProfile]);

  useEffect(() => {
    const flushOnVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void saveCurrentSnapshot();
      }
    };

    document.addEventListener("visibilitychange", flushOnVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", flushOnVisibilityChange);
  }, [saveCurrentSnapshot]);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    let cancelled = false;

    estimateArchiveSizeText(currentSnapshot)
      .then((sizeText) => {
        if (!cancelled) {
          setArchiveSizeText(sizeText);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setArchiveSizeText("未知");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentSnapshot, settingsOpen]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const stopResponse = useCallback(
    (replacementText = "已停止生成。") => {
      if (!pendingMessageId) {
        return;
      }

      abortControllerRef.current?.abort();
      abortControllerRef.current = null;

      setMessages((current) =>
        current.map((message) =>
          message.id === pendingMessageId
            ? {
                ...message,
                status: "stopped",
                text:
                  message.text && message.text !== "正在请求模型…"
                    ? message.text
                    : replacementText,
              }
            : message,
        ),
      );
      setPendingMessageId(null);
    },
    [pendingMessageId],
  );

  const activateAssistant = (assistantId: string) => {
    const nextAssistant =
      assistants.find((assistant) => assistant.id === assistantId) ??
      activeAssistant;
    setActiveAssistantId(nextAssistant.id);
    setEditingAssistantId(nextAssistant.id);
    setActiveModelRef(
      chooseModelForAssistant(nextAssistant, activeModelRef, apiProfiles),
    );
  };

  const createConversation = () => {
    const nextIndex = conversations.length + 1;
    const newConversation: Conversation = {
      id: createId("conversation"),
      title: `新对话 ${nextIndex}`,
      summary: "尚未生成摘要",
      archived: false,
    };

    setConversations((current) => [newConversation, ...current]);
    setActiveConversationId(newConversation.id);
    setConversationSearch("");
    setDrawerOpen(false);
    setDraft("");
    setEditingTitleConversationId(null);
    setTitleDraft("");
    stopResponse("已停止上一条未完成回复。");
  };

  const selectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId);
    setDrawerOpen(false);
    setDraft("");
    setEditingTitleConversationId(null);
    setTitleDraft("");
    stopResponse("已停止上一条未完成回复。");
  };

  const startTitleEdit = () => {
    if (!activeConversation) {
      return;
    }

    setEditingTitleConversationId(activeConversation.id);
    setTitleDraft(activeConversation.title);
  };

  const cancelTitleEdit = () => {
    setEditingTitleConversationId(null);
    setTitleDraft("");
  };

  const saveTitleEdit = () => {
    if (!activeConversation) {
      return;
    }

    const nextTitle = titleDraft.trim();
    if (nextTitle) {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === activeConversation.id
            ? { ...conversation, title: nextTitle }
            : conversation,
        ),
      );
    }

    cancelTitleEdit();
  };

  const archiveActiveConversation = () => {
    if (!activeConversation) {
      return;
    }

    const nextActive = conversations.find(
      (conversation) =>
        conversation.id !== activeConversation.id && !conversation.archived,
    );

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, archived: true }
          : conversation,
      ),
    );

    if (nextActive) {
      setActiveConversationId(nextActive.id);
      return;
    }

    const fallbackConversation: Conversation = {
      id: createId("conversation"),
      title: "新对话",
      summary: "当前没有未归档对话",
      archived: false,
    };
    setConversations((current) => [fallbackConversation, ...current]);
    setActiveConversationId(fallbackConversation.id);
  };

  const openSettings = () => {
    setEditingAssistantId(activeAssistant.id);
    setDrawerOpen(false);
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    void saveCurrentSnapshot();
  };

  const downloadArchive = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = createArchiveDownloadName();
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportBackup = async () => {
    setBackupMessage("正在导出 .mobilechat");
    await saveCurrentSnapshot();

    try {
      const committedSnapshot = await loadSnapshot();
      const archive = await createMobileChatArchive(committedSnapshot, {
        includeCredentials: false,
      });
      downloadArchive(archive);

      const exportedAt = new Date().toISOString();
      const snapshotWithExportTime =
        await updateLastSuccessfulExport(exportedAt);
      applySnapshot(snapshotWithExportTime);
      setBackupMessage("已生成 credential-free .mobilechat 导出文件");
    } catch (error) {
      setBackupMessage(
        error instanceof Error ? error.message : "导出 .mobilechat 失败",
      );
    }
  };

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setBackupMessage("正在验证导入文件");

    try {
      const importedSnapshot = await readMobileChatArchive(file);
      await replaceSnapshot(importedSnapshot);
      applySnapshot(importedSnapshot);
      setSaveStatus("saved");
      setBackupMessage("已导入 .mobilechat 并替换本地数据");
    } catch (error) {
      setSaveStatus("failed");
      setBackupMessage(
        error instanceof Error ? error.message : "导入 .mobilechat 失败",
      );
    }
  };

  const createAssistant = () => {
    const baseModel = activeResolvedModel ?? allModelOptions[0];
    const newAssistant: Assistant = {
      id: createId("assistant"),
      name: `新助手 ${assistants.length + 1}`,
      description: "通过详情面板编辑这个助手。",
      kind: "chat",
      modelBindings: baseModel
        ? [createBinding(baseModel.apiProfile, baseModel.model, true)]
        : [],
      prompt: "",
      initialMessage: "",
      enabled: true,
    };

    setAssistants((current) => [...current, newAssistant]);
    setActiveAssistantId(newAssistant.id);
    setEditingAssistantId(newAssistant.id);
    if (baseModel) {
      setActiveModelRef(baseModel.ref);
    }
  };

  const updateAssistantField = (
    assistantId: string,
    key: AssistantFieldKey,
    value: string | boolean,
  ) => {
    setAssistants((current) =>
      current.map((assistant) =>
        assistant.id === assistantId
          ? { ...assistant, [key]: value }
          : assistant,
      ),
    );
  };

  const createApiProfile = () => {
    const newProfile: ApiProfile = {
      id: createId("api-profile"),
      name: `API Profile ${apiProfiles.length + 1}`,
      description: "OpenAI-compatible Responses API 配置",
      baseUrl: "https://api.example.com/v1",
      apiKey: "",
      protocol: "openai-responses",
      enabled: true,
      models: [
        {
          id: "gpt-5.4",
          name: "gpt-5.4",
          description: "新建模型预设",
          contextWindow: 128000,
          enabled: true,
        },
      ],
    };

    setApiProfiles((current) => [...current, newProfile]);
    setEditingApiProfileId(newProfile.id);
    setEditingModelId(newProfile.models[0]?.id ?? "");
  };

  const updateApiProfileField = (
    profileId: string,
    key: keyof Pick<
      ApiProfile,
      "name" | "description" | "baseUrl" | "apiKey" | "enabled"
    >,
    value: string | boolean,
  ) => {
    setApiProfiles((current) =>
      current.map((profile) =>
        profile.id === profileId ? { ...profile, [key]: value } : profile,
      ),
    );

    if (key === "name") {
      setAssistants((current) =>
        current.map((assistant) => ({
          ...assistant,
          modelBindings: assistant.modelBindings.map((binding) =>
            binding.apiProfileId === profileId
              ? { ...binding, apiProfileNameSnapshot: String(value) }
              : binding,
          ),
        })),
      );
    }
  };

  const createModel = (profileId: string) => {
    const profile = apiProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      return;
    }

    const modelId = `new-model-${profile.models.length + 1}`;
    setApiProfiles((current) =>
      current.map((candidate) =>
        candidate.id === profileId
          ? {
              ...candidate,
              models: [
                ...candidate.models,
                {
                  id: modelId,
                  name: modelId,
                  description: "通过模型详情面板编辑这个模型。",
                  contextWindow: 128000,
                  enabled: true,
                },
              ],
            }
          : candidate,
      ),
    );
    setEditingModelId(modelId);
  };

  const updateModelField = (
    profileId: string,
    modelId: string,
    key: keyof Pick<
      ModelDefinition,
      "id" | "name" | "description" | "contextWindow" | "enabled"
    >,
    value: string | number | boolean,
  ) => {
    const nextModelId =
      key === "id" && typeof value === "string" && value.trim()
        ? value.trim()
        : modelId;

    setApiProfiles((current) =>
      current.map((profile) =>
        profile.id === profileId
          ? {
              ...profile,
              models: profile.models.map((model) =>
                model.id === modelId
                  ? {
                      ...model,
                      [key]:
                        key === "contextWindow"
                          ? Number(value) || undefined
                          : key === "id"
                            ? nextModelId
                            : value,
                    }
                  : model,
              ),
            }
          : profile,
      ),
    );

    setAssistants((current) =>
      current.map((assistant) => ({
        ...assistant,
        modelBindings: assistant.modelBindings.map((binding) => {
          if (
            binding.apiProfileId !== profileId ||
            binding.modelId !== modelId
          ) {
            return binding;
          }

          return {
            ...binding,
            modelId: nextModelId,
            modelNameSnapshot:
              key === "name" ? String(value) : binding.modelNameSnapshot,
            modelDescriptionSnapshot:
              key === "description"
                ? String(value)
                : binding.modelDescriptionSnapshot,
          };
        }),
      })),
    );

    if (key === "id" && nextModelId !== modelId) {
      setEditingModelId(nextModelId);
      setActiveModelRef((current) =>
        current.apiProfileId === profileId && current.modelId === modelId
          ? { ...current, modelId: nextModelId }
          : current,
      );
    }
  };

  const toggleAssistantModelBinding = (
    assistantId: string,
    option: ResolvedModel,
    checked: boolean,
  ) => {
    setAssistants((current) =>
      current.map((assistant) => {
        if (assistant.id !== assistantId) {
          return assistant;
        }

        const optionKey = option.key;
        const existingBindings = assistant.modelBindings;
        const hasBinding = existingBindings.some(
          (binding) => modelRefKey(binding) === optionKey,
        );

        if (checked && !hasBinding) {
          const nextBindings = [
            ...existingBindings,
            createBinding(
              option.apiProfile,
              option.model,
              !existingBindings.some((binding) => binding.isDefault),
            ),
          ];
          return { ...assistant, modelBindings: nextBindings };
        }

        if (!checked && hasBinding && existingBindings.length > 1) {
          const remaining = existingBindings.filter(
            (binding) => modelRefKey(binding) !== optionKey,
          );
          const hasDefault = remaining.some((binding) => binding.isDefault);
          return {
            ...assistant,
            modelBindings: hasDefault
              ? remaining
              : remaining.map((binding, index) => ({
                  ...binding,
                  isDefault: index === 0,
                })),
          };
        }

        return assistant;
      }),
    );
  };

  const setAssistantDefaultModel = (
    assistantId: string,
    bindingKey: string,
  ) => {
    setAssistants((current) =>
      current.map((assistant) =>
        assistant.id === assistantId
          ? {
              ...assistant,
              modelBindings: assistant.modelBindings.map((binding) => ({
                ...binding,
                isDefault: modelRefKey(binding) === bindingKey,
              })),
            }
          : assistant,
      ),
    );

    if (assistantId === activeAssistant.id) {
      setActiveModelRef(parseModelRefKey(bindingKey));
    }
  };

  const sendMessage = async () => {
    const text = draft.trim();
    const resolvedModel = activeResolvedModel;

    if (!text || !activeConversation || pendingMessageId) {
      return;
    }

    if (!resolvedModel) {
      const assistantMessage: Message = {
        id: createId("assistant"),
        conversationId: activeConversation.id,
        role: "assistant",
        label: activeAssistant.name,
        text: "当前助手没有可用模型。请先在设置页为助手绑定启用的模型。",
        status: "error",
      };
      setDraft("");
      setMessages((current) => [...current, assistantMessage]);
      return;
    }

    const source = createSourceSnapshot(activeAssistant, resolvedModel);
    const userMessage: Message = {
      id: createId("message"),
      conversationId: activeConversation.id,
      role: "user",
      label: "用户",
      text,
      status: "complete",
      source,
    };
    const assistantMessage: Message = {
      id: createId("assistant"),
      conversationId: activeConversation.id,
      role: "assistant",
      label: `${activeAssistant.name} · ${resolvedModel.model.name}`,
      text: "正在请求模型…",
      status: "streaming",
      source,
    };
    const controller = new AbortController();
    let streamedText = "";

    abortControllerRef.current = controller;
    setDraft("");
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setPendingMessageId(assistantMessage.id);
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              summary: `最近消息：${text.slice(0, 28)}`,
            }
          : conversation,
      ),
    );

    try {
      const result = await requestResponsesChat({
        apiProfile: resolvedModel.apiProfile,
        assistant: activeAssistant,
        conversation: activeConversation,
        model: resolvedModel.model,
        messages: [...activeMessages, userMessage],
        signal: controller.signal,
        stream: streamingEnabled,
        onTextDelta: streamingEnabled
          ? (_delta, fullText) => {
              streamedText = fullText;
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessage.id
                    ? { ...message, text: fullText || "正在请求模型…" }
                    : message,
                ),
              );
            }
          : undefined,
      });

      setLastObservedUsage(result.usage);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                status: "complete",
                text: result.text || streamedText || "模型未返回文本内容。",
                providerResponseId: result.providerResponseId,
                usage: result.usage,
              }
            : message,
        ),
      );
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                status: "error",
                text:
                  error instanceof Error
                    ? error.message
                    : "请求模型失败，请检查 API Profile、模型和网络。",
              }
            : message,
        ),
      );
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (!controller.signal.aborted) {
        setPendingMessageId(null);
      }
    }
  };

  const sendOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  };

  return (
    <main className="app-shell">
      {pwaNotice ? (
        <aside className="pwa-banner" role="status">
          <span>
            {pwaNotice === "update-available"
              ? "发现新版本，可立即刷新更新。"
              : "已缓存离线外壳，断网时仍可打开页面。"}
          </span>
          <button
            type="button"
            onClick={() => {
              if (pwaNotice === "update-available") {
                window.dispatchEvent(new Event("mobilechat:pwa-apply-update"));
                return;
              }
              setPwaNotice(null);
            }}
          >
            {pwaNotice === "update-available" ? "更新" : "知道了"}
          </button>
        </aside>
      ) : null}

      {drawerOpen ? (
        <button
          className="drawer-scrim mobile-only"
          type="button"
          aria-label="关闭对话列表"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <aside className={`conversation-rail ${drawerOpen ? "open" : ""}`}>
        <header className="rail-header">
          <div>
            <p className="eyebrow">MobileChat</p>
            <h1>对话</h1>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="新建对话"
            onClick={createConversation}
          >
            <MessageSquarePlus size={20} />
          </button>
        </header>

        <label className="search-box">
          <Search size={18} />
          <input
            placeholder="搜索标题或摘要"
            value={conversationSearch}
            onChange={(event) => setConversationSearch(event.target.value)}
          />
        </label>

        <nav className="conversation-list" aria-label="对话列表">
          {visibleConversations.map((conversation) => (
            <button
              className={`conversation-item ${
                conversation.id === activeConversation?.id ? "selected" : ""
              }`}
              key={conversation.id}
              type="button"
              onClick={() => selectConversation(conversation.id)}
            >
              <span>{conversation.title}</span>
              <small>{conversation.summary}</small>
            </button>
          ))}
          {visibleConversations.length === 0 ? (
            <p className="empty-list">没有匹配的对话</p>
          ) : null}
        </nav>

        <footer className="rail-footer">
          <button type="button" onClick={archiveActiveConversation}>
            <Archive size={18} />
            归档当前
          </button>
          <button type="button" onClick={openSettings}>
            <Settings size={18} />
            设置
          </button>
        </footer>
      </aside>

      <section className="chat-surface" aria-label="当前对话">
        <header className="chat-header">
          <button
            className="icon-button mobile-only"
            type="button"
            aria-label="打开对话列表"
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <PanelLeft size={20} />
          </button>
          <div className="chat-title">
            {editingTitleConversationId === activeConversation?.id ? (
              <div className="title-editor">
                <input
                  aria-label="对话标题"
                  autoFocus
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      saveTitleEdit();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelTitleEdit();
                    }
                  }}
                />
                <button
                  className="title-action"
                  type="button"
                  aria-label="保存标题"
                  onClick={saveTitleEdit}
                >
                  <Check size={15} />
                </button>
                <button
                  className="title-action"
                  type="button"
                  aria-label="取消标题编辑"
                  onClick={cancelTitleEdit}
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <div className="title-display">
                <p>{activeConversation?.title ?? "未选择对话"}</p>
                {activeConversation ? (
                  <button
                    className="title-edit-button"
                    type="button"
                    aria-label="编辑标题"
                    onClick={startTitleEdit}
                  >
                    <Pencil size={14} />
                  </button>
                ) : null}
              </div>
            )}
            <span>{activeConversation?.summary ?? "请新建或选择一个对话"}</span>
          </div>
          <div className="chat-pickers">
            <label className="assistant-picker">
              <Bot size={18} />
              <span className="sr-only">选择助手</span>
              <select
                aria-label="选择助手"
                value={activeAssistant.id}
                onChange={(event) => activateAssistant(event.target.value)}
              >
                {assistants.map((assistant) => (
                  <option key={assistant.id} value={assistant.id}>
                    {assistant.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="assistant-picker model-picker">
              <Server size={18} />
              <span className="sr-only">选择模型</span>
              <select
                aria-label="选择模型"
                disabled={assistantModelOptions.length === 0}
                value={
                  activeResolvedModel
                    ? modelRefKey(activeResolvedModel.ref)
                    : modelRefKey(DEFAULT_MODEL_REF)
                }
                onChange={(event) =>
                  setActiveModelRef(parseModelRefKey(event.target.value))
                }
              >
                {assistantModelOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.model.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div className="message-thread">
          {activeMessages.length > 0 ? (
            activeMessages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="message-label">
                  {message.label}
                  {message.status === "streaming" ? " · 生成中" : ""}
                  {message.status === "stopped" ? " · 已停止" : ""}
                  {message.status === "error" ? " · 错误" : ""}
                </div>
                <p>{message.text}</p>
              </article>
            ))
          ) : (
            <section className="empty-thread">
              <h2>开始一个新对话</h2>
              <p>
                当前已接入最小 Responses 请求循环；请先在设置页填写本地 API
                key。
              </p>
            </section>
          )}
        </div>

        {debugEnabled ? (
          <section className="diagnostics-panel" aria-label="调试诊断">
            <header>
              <SlidersHorizontal size={18} />
              <span>Context diagnostics</span>
            </header>
            <div className="diagnostic-grid">
              {diagnostics.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <footer className="composer">
          <button
            className="icon-button"
            type="button"
            aria-label="停止"
            disabled={!pendingMessageId}
            onClick={() => stopResponse()}
          >
            <StopCircle size={20} />
          </button>
          <textarea
            rows={1}
            placeholder="输入消息"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={sendOnEnter}
          />
          <button
            className="send-button"
            type="button"
            aria-label="发送"
            disabled={!draft.trim() || Boolean(pendingMessageId)}
            onClick={() => void sendMessage()}
          >
            <Send size={18} />
          </button>
        </footer>
      </section>

      {settingsOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeSettings();
            }
          }}
        >
          <section
            className="settings-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
          >
            <header>
              <div>
                <p className="eyebrow">Settings</p>
                <h2 id="settings-title">设置</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭设置"
                onClick={closeSettings}
              >
                ×
              </button>
            </header>

            <section className="settings-summary" aria-label="设置概览">
              <div className="settings-row compact">
                <span>保存状态</span>
                <strong>{saveStatusLabels[saveStatus]}</strong>
              </div>
              <label className="settings-row compact theme-select">
                <span>
                  <Palette size={16} />
                  主题模式
                </span>
                <select
                  aria-label="主题模式"
                  value={themeMode}
                  onChange={(event) =>
                    setThemeMode(event.target.value as ThemeMode)
                  }
                >
                  {Object.entries(themeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="settings-row compact">
                <span>调试模式</span>
                <label className="switch">
                  <input
                    checked={debugEnabled}
                    onChange={(event) => setDebugEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  <span />
                </label>
              </div>
              <div className="settings-row compact">
                <span>流式输出</span>
                <label className="switch">
                  <input
                    aria-label="流式输出"
                    checked={streamingEnabled}
                    onChange={(event) =>
                      setStreamingEnabled(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span />
                </label>
              </div>
              <div className="settings-row compact">
                <span>API Profiles</span>
                <strong>{apiProfiles.length}</strong>
              </div>
              <div className="settings-row compact">
                <span>聊天助手</span>
                <strong>{chatAssistantCount}</strong>
              </div>
              <div className="settings-row compact">
                <span>功能助手</span>
                <strong>{utilityAssistantCount}</strong>
              </div>
            </section>

            <section className="backup-panel" aria-label="备份与存储">
              <header>
                <div>
                  <p className="eyebrow">Persistence</p>
                  <h3>本地持久化与备份</h3>
                </div>
              </header>
              <div className="backup-grid">
                <div>
                  <span>数据库</span>
                  <strong>MobileChatDB</strong>
                </div>
                <div>
                  <span>持久模式</span>
                  <strong>
                    {storageInfo.persisted === true
                      ? "persistent"
                      : storageInfo.persisted === false
                        ? "best-effort"
                        : "unknown"}
                  </strong>
                </div>
                <div>
                  <span>用量 / 配额</span>
                  <strong>{formatStorageUsage(storageInfo)}</strong>
                </div>
                <div>
                  <span>预计导出大小</span>
                  <strong>{archiveSizeText}</strong>
                </div>
                <div>
                  <span>最后导出</span>
                  <strong>
                    {lastSuccessfulExportAt
                      ? new Date(lastSuccessfulExportAt).toLocaleString()
                      : "从未"}
                  </strong>
                </div>
              </div>
              <div className="backup-actions">
                <button type="button" onClick={exportBackup}>
                  <Download size={16} />
                  导出 .mobilechat
                </button>
                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                >
                  <Upload size={16} />
                  导入并替换
                </button>
                <input
                  ref={importInputRef}
                  aria-label="导入 mobilechat 文件"
                  type="file"
                  accept=".mobilechat,application/zip,application/vnd.mobilechat+zip"
                  onChange={importBackup}
                />
              </div>
              {saveError || backupMessage ? (
                <p className="backup-message">{saveError || backupMessage}</p>
              ) : null}
            </section>

            <section
              className="api-profile-panel"
              aria-label="API Profile 与模型"
            >
              <header>
                <div>
                  <p className="eyebrow">Routes</p>
                  <h3>API Profile 与模型</h3>
                </div>
                <button type="button" onClick={createApiProfile}>
                  <Plus size={16} />
                  新增 Profile
                </button>
              </header>

              <div className="profile-layout">
                <aside className="profile-directory">
                  <label className="assistant-config-select">
                    <span>当前 Profile</span>
                    <select
                      aria-label="选择 API Profile"
                      value={editingApiProfile?.id ?? ""}
                      onChange={(event) => {
                        const profile = apiProfiles.find(
                          (candidate) => candidate.id === event.target.value,
                        );
                        setEditingApiProfileId(event.target.value);
                        setEditingModelId(profile?.models[0]?.id ?? "");
                      }}
                    >
                      {apiProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="assistant-card-list">
                    {apiProfiles.map((profile) => (
                      <button
                        className={`assistant-card ${
                          profile.id === editingApiProfile?.id ? "selected" : ""
                        }`}
                        key={profile.id}
                        type="button"
                        onClick={() => {
                          setEditingApiProfileId(profile.id);
                          setEditingModelId(profile.models[0]?.id ?? "");
                        }}
                      >
                        <span>{profile.name}</span>
                        <small>{profile.models.length} models</small>
                      </button>
                    ))}
                  </div>
                </aside>

                {editingApiProfile ? (
                  <section className="profile-detail">
                    <div className="section-caption">
                      <Server size={16} />
                      <span>连接配置</span>
                    </div>
                    <div className="reflected-fields">
                      <label className="detail-field">
                        <span>Profile 名称</span>
                        <input
                          aria-label="Profile 名称"
                          value={editingApiProfile.name}
                          onChange={(event) =>
                            updateApiProfileField(
                              editingApiProfile.id,
                              "name",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="detail-field">
                        <span>协议</span>
                        <select
                          aria-label="协议"
                          value={editingApiProfile.protocol}
                          disabled
                        >
                          <option value="openai-responses">
                            OpenAI-compatible Responses
                          </option>
                        </select>
                      </label>
                      <label className="detail-field">
                        <span>Base URL</span>
                        <input
                          aria-label="Base URL"
                          value={editingApiProfile.baseUrl}
                          onChange={(event) =>
                            updateApiProfileField(
                              editingApiProfile.id,
                              "baseUrl",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="detail-field">
                        <span>
                          <KeyRound size={14} />
                          API Key
                        </span>
                        <input
                          aria-label="API Key"
                          type="password"
                          value={editingApiProfile.apiKey}
                          onChange={(event) =>
                            updateApiProfileField(
                              editingApiProfile.id,
                              "apiKey",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                      <label className="detail-field checkbox-field">
                        <span>启用 Profile</span>
                        <input
                          aria-label="启用 Profile"
                          checked={editingApiProfile.enabled}
                          type="checkbox"
                          onChange={(event) =>
                            updateApiProfileField(
                              editingApiProfile.id,
                              "enabled",
                              event.target.checked,
                            )
                          }
                        />
                      </label>
                      <label className="detail-field">
                        <span>Profile 描述</span>
                        <textarea
                          aria-label="Profile 描述"
                          rows={3}
                          value={editingApiProfile.description}
                          onChange={(event) =>
                            updateApiProfileField(
                              editingApiProfile.id,
                              "description",
                              event.target.value,
                            )
                          }
                        />
                      </label>
                    </div>

                    <div className="model-editor-header">
                      <div className="section-caption">
                        <Database size={16} />
                        <span>模型配置</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => createModel(editingApiProfile.id)}
                      >
                        <Plus size={16} />
                        新增模型
                      </button>
                    </div>

                    <label className="assistant-config-select">
                      <span>当前模型</span>
                      <select
                        aria-label="选择模型配置"
                        value={editingModel?.id ?? ""}
                        onChange={(event) =>
                          setEditingModelId(event.target.value)
                        }
                      >
                        {editingApiProfile.models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    {editingModel ? (
                      <div className="reflected-fields">
                        <label className="detail-field">
                          <span>模型 ID / slug</span>
                          <input
                            aria-label="模型 ID"
                            value={editingModel.id}
                            onChange={(event) =>
                              updateModelField(
                                editingApiProfile.id,
                                editingModel.id,
                                "id",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="detail-field">
                          <span>显示名称</span>
                          <input
                            aria-label="模型名称"
                            value={editingModel.name}
                            onChange={(event) =>
                              updateModelField(
                                editingApiProfile.id,
                                editingModel.id,
                                "name",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="detail-field">
                          <span>上下文窗口</span>
                          <input
                            aria-label="上下文窗口"
                            inputMode="numeric"
                            value={editingModel.contextWindow ?? ""}
                            onChange={(event) =>
                              updateModelField(
                                editingApiProfile.id,
                                editingModel.id,
                                "contextWindow",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                        <label className="detail-field checkbox-field">
                          <span>启用模型</span>
                          <input
                            aria-label="启用模型"
                            checked={editingModel.enabled}
                            type="checkbox"
                            onChange={(event) =>
                              updateModelField(
                                editingApiProfile.id,
                                editingModel.id,
                                "enabled",
                                event.target.checked,
                              )
                            }
                          />
                        </label>
                        <label className="detail-field">
                          <span>模型描述</span>
                          <textarea
                            aria-label="模型描述"
                            rows={3}
                            value={editingModel.description}
                            onChange={(event) =>
                              updateModelField(
                                editingApiProfile.id,
                                editingModel.id,
                                "description",
                                event.target.value,
                              )
                            }
                          />
                        </label>
                      </div>
                    ) : null}
                  </section>
                ) : null}
              </div>
            </section>

            <section className="settings-layout">
              <aside className="assistant-directory" aria-label="助手列表">
                <div className="directory-header">
                  <div>
                    <p className="eyebrow">Assistants</p>
                    <h3>助手</h3>
                  </div>
                  <button type="button" onClick={createAssistant}>
                    <Plus size={16} />
                    新增
                  </button>
                </div>

                <label className="assistant-config-select">
                  <span>当前编辑</span>
                  <select
                    aria-label="设置中选择助手"
                    value={editingAssistant.id}
                    onChange={(event) =>
                      setEditingAssistantId(event.target.value)
                    }
                  >
                    {assistants.map((assistant) => (
                      <option key={assistant.id} value={assistant.id}>
                        {assistant.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="assistant-card-list">
                  {assistants.map((assistant) => {
                    const defaultBinding =
                      assistant.modelBindings.find(
                        (binding) => binding.isDefault,
                      ) ?? assistant.modelBindings[0];
                    return (
                      <button
                        className={`assistant-card ${
                          assistant.id === editingAssistant.id ? "selected" : ""
                        }`}
                        key={assistant.id}
                        type="button"
                        onClick={() => setEditingAssistantId(assistant.id)}
                      >
                        <span>{assistant.name}</span>
                        <small>
                          {assistant.kind === "chat" ? "聊天助手" : "功能助手"}{" "}
                          · {defaultBinding?.modelNameSnapshot ?? "未绑定模型"}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="assistant-detail" aria-label="助手详情">
                <header>
                  <div>
                    <p className="eyebrow">Details</p>
                    <h3>{editingAssistant.name}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => activateAssistant(editingAssistant.id)}
                  >
                    设为当前
                  </button>
                </header>

                <div className="reflected-fields">
                  {assistantFields.map((field) => {
                    const value = editingAssistant[field.key];

                    if (field.control === "checkbox") {
                      return (
                        <label
                          className="detail-field checkbox-field"
                          key={field.key}
                        >
                          <span>{field.label}</span>
                          <input
                            aria-label={field.label}
                            checked={Boolean(value)}
                            type="checkbox"
                            onChange={(event) =>
                              updateAssistantField(
                                editingAssistant.id,
                                field.key,
                                event.target.checked,
                              )
                            }
                          />
                        </label>
                      );
                    }

                    if (field.control === "select") {
                      return (
                        <label className="detail-field" key={field.key}>
                          <span>{field.label}</span>
                          <select
                            aria-label={field.label}
                            value={String(value)}
                            onChange={(event) =>
                              updateAssistantField(
                                editingAssistant.id,
                                field.key,
                                event.target.value,
                              )
                            }
                          >
                            {field.options?.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          {field.helper ? <small>{field.helper}</small> : null}
                        </label>
                      );
                    }

                    if (field.control === "textarea") {
                      return (
                        <label className="detail-field" key={field.key}>
                          <span>{field.label}</span>
                          <textarea
                            aria-label={field.label}
                            placeholder={field.placeholder}
                            rows={field.key === "prompt" ? 4 : 3}
                            value={String(value)}
                            onChange={(event) =>
                              updateAssistantField(
                                editingAssistant.id,
                                field.key,
                                event.target.value,
                              )
                            }
                          />
                          {field.helper ? <small>{field.helper}</small> : null}
                        </label>
                      );
                    }

                    return (
                      <label className="detail-field" key={field.key}>
                        <span>{field.label}</span>
                        <input
                          aria-label={field.label}
                          placeholder={field.placeholder}
                          value={String(value)}
                          onChange={(event) =>
                            updateAssistantField(
                              editingAssistant.id,
                              field.key,
                              event.target.value,
                            )
                          }
                        />
                        {field.helper ? <small>{field.helper}</small> : null}
                      </label>
                    );
                  })}
                </div>

                <section className="model-bindings" aria-label="助手允许模型">
                  <header>
                    <div>
                      <p className="eyebrow">Model access</p>
                      <h3>助手允许模型</h3>
                    </div>
                  </header>
                  <label className="assistant-config-select">
                    <span>默认模型</span>
                    <select
                      aria-label="助手默认模型"
                      value={modelRefKey(
                        editingAssistant.modelBindings.find(
                          (binding) => binding.isDefault,
                        ) ??
                          editingAssistant.modelBindings[0] ??
                          DEFAULT_MODEL_REF,
                      )}
                      onChange={(event) =>
                        setAssistantDefaultModel(
                          editingAssistant.id,
                          event.target.value,
                        )
                      }
                    >
                      {editingAssistant.modelBindings.map((binding) => (
                        <option
                          key={modelRefKey(binding)}
                          value={modelRefKey(binding)}
                        >
                          {binding.apiProfileNameSnapshot} /{" "}
                          {binding.modelNameSnapshot}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="binding-list">
                    {allModelOptions.map((option) => {
                      const checked = editingAssistant.modelBindings.some(
                        (binding) => modelRefKey(binding) === option.key,
                      );
                      return (
                        <label className="binding-row" key={option.key}>
                          <input
                            aria-label={`允许模型 ${option.apiProfile.name} ${option.model.name}`}
                            checked={checked}
                            type="checkbox"
                            onChange={(event) =>
                              toggleAssistantModelBinding(
                                editingAssistant.id,
                                option,
                                event.target.checked,
                              )
                            }
                          />
                          <span>
                            <strong>
                              {option.apiProfile.name} / {option.model.name}
                            </strong>
                            <small>{option.model.description}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              </section>
            </section>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
