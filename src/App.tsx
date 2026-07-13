import {
  Archive,
  Bot,
  Download,
  MessageSquarePlus,
  PanelLeft,
  Plus,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  StopCircle,
  Upload,
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
import "./App.css";
import {
  type AppSettings,
  type Assistant,
  type AssistantFieldKey,
  assistantFields,
  type Conversation,
  createId,
  createInitialSnapshot,
  defaultAssistant,
  diagnostics,
  type LocalDataSnapshot,
  type Message,
  type SaveStatus,
  type StorageInfo,
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

const bootSnapshot = createInitialSnapshot();
const AUTOSAVE_DELAY_MS = 400;

function App() {
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
  const [editingAssistantId, setEditingAssistantId] = useState(
    bootSnapshot.settings.editingAssistantId,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(
    bootSnapshot.settings.debugEnabled,
  );
  const [draft, setDraft] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
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
  const [pwaNotice, setPwaNotice] = useState<PwaNotice>(null);
  const responseTimerRef = useRef<number | null>(null);
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
  const appSettings = useMemo<AppSettings>(
    () => ({
      ...bootSnapshot.settings,
      activeConversationId,
      activeAssistantId,
      editingAssistantId,
      debugEnabled,
      lastSuccessfulExportAt,
      storagePersisted: storageInfo.persisted,
      storageUsage: storageInfo.usage,
      storageQuota: storageInfo.quota,
    }),
    [
      activeAssistantId,
      activeConversationId,
      debugEnabled,
      editingAssistantId,
      lastSuccessfulExportAt,
      storageInfo.persisted,
      storageInfo.quota,
      storageInfo.usage,
    ],
  );
  const currentSnapshot = useMemo<LocalDataSnapshot>(
    () => ({
      settings: appSettings,
      assistants,
      conversations,
      messages,
    }),
    [appSettings, assistants, conversations, messages],
  );

  const applySnapshot = useCallback((snapshot: LocalDataSnapshot) => {
    setAssistants(snapshot.assistants);
    setConversations(snapshot.conversations);
    setMessages(snapshot.messages);
    setActiveConversationId(snapshot.settings.activeConversationId);
    setActiveAssistantId(snapshot.settings.activeAssistantId);
    setEditingAssistantId(snapshot.settings.editingAssistantId);
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
      if (responseTimerRef.current) {
        window.clearTimeout(responseTimerRef.current);
      }
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

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
    stopResponse("已停止上一条未完成回复。");
  };

  const selectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId);
    setDrawerOpen(false);
    setDraft("");
    stopResponse("已停止上一条未完成回复。");
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
    const nextAssistant: Assistant = {
      id: createId("assistant"),
      name: `新助手 ${assistants.length + 1}`,
      description: "通过详情面板编辑这个助手。",
      kind: "chat",
      apiProfileName: activeAssistant.apiProfileName,
      model: activeAssistant.model,
      prompt: "",
      initialMessage: "",
      enabled: true,
    };

    setAssistants((current) => [...current, nextAssistant]);
    setActiveAssistantId(nextAssistant.id);
    setEditingAssistantId(nextAssistant.id);
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

  const stopResponse = (replacementText = "已停止生成。") => {
    if (!pendingMessageId) {
      return;
    }

    if (responseTimerRef.current) {
      window.clearTimeout(responseTimerRef.current);
      responseTimerRef.current = null;
    }

    setMessages((current) =>
      current.map((message) =>
        message.id === pendingMessageId
          ? { ...message, status: "stopped", text: replacementText }
          : message,
      ),
    );
    setPendingMessageId(null);
  };

  const sendMessage = () => {
    const text = draft.trim();

    if (!text || !activeConversation || pendingMessageId) {
      return;
    }

    const userMessage: Message = {
      id: createId("message"),
      conversationId: activeConversation.id,
      role: "user",
      label: "用户",
      text,
      status: "complete",
    };
    const assistantMessage: Message = {
      id: createId("assistant"),
      conversationId: activeConversation.id,
      role: "assistant",
      label: `${activeAssistant.name} · ${activeAssistant.model}`,
      text: "正在生成模拟回复……",
      status: "streaming",
    };

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

    responseTimerRef.current = window.setTimeout(() => {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                status: "complete",
                text: `这是首版本地交互占位回复：已收到「${text}」。下一阶段会接入本地持久化和真实 Responses API。`,
              }
            : message,
        ),
      );
      setPendingMessageId(null);
      responseTimerRef.current = null;
    }, 800);
  };

  const sendOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    sendMessage();
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
            <p>{activeConversation?.title ?? "未选择对话"}</p>
            <span>{activeConversation?.summary ?? "请新建或选择一个对话"}</span>
          </div>
          <label className="assistant-picker">
            <Bot size={18} />
            <span className="sr-only">选择助手</span>
            <select
              aria-label="选择助手"
              value={activeAssistant.id}
              onChange={(event) => {
                setActiveAssistantId(event.target.value);
                setEditingAssistantId(event.target.value);
              }}
            >
              {assistants.map((assistant) => (
                <option key={assistant.id} value={assistant.id}>
                  {assistant.name}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div className="message-thread">
          {activeMessages.length > 0 ? (
            activeMessages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="message-label">
                  {message.label}
                  {message.status === "streaming" ? " · 生成中" : ""}
                  {message.status === "stopped" ? " · 已停止" : ""}
                </div>
                <p>{message.text}</p>
              </article>
            ))
          ) : (
            <section className="empty-thread">
              <h2>开始一个新对话</h2>
              <p>当前仍是本地交互原型，发送后会生成模拟回复。</p>
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
            onClick={sendMessage}
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
                <strong>
                  {saveStatus === "loading"
                    ? "加载中"
                    : saveStatus === "unsaved"
                      ? "未保存"
                      : saveStatus === "saving"
                        ? "保存中"
                        : saveStatus === "saved"
                          ? "已保存"
                          : "保存失败"}
                </strong>
              </div>
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
                <span>API Profiles</span>
                <strong>1</strong>
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
                  <strong>
                    {typeof storageInfo.usage === "number" &&
                    typeof storageInfo.quota === "number"
                      ? `${(storageInfo.usage / 1024).toFixed(1)} KB / ${(
                          storageInfo.quota /
                          1024 /
                          1024
                        ).toFixed(1)} MB`
                      : "unknown"}
                  </strong>
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
                  {assistants.map((assistant) => (
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
                        {assistant.kind === "chat" ? "聊天助手" : "功能助手"} ·{" "}
                        {assistant.model}
                      </small>
                    </button>
                  ))}
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
                    onClick={() => setActiveAssistantId(editingAssistant.id)}
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
              </section>
            </section>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
