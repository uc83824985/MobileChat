import {
  Archive,
  Bot,
  MessageSquarePlus,
  PanelLeft,
  Plus,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  StopCircle,
} from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./App.css";

type Conversation = {
  id: string;
  title: string;
  summary: string;
  archived: boolean;
};

type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  label: string;
  text: string;
  status?: "streaming" | "stopped" | "complete";
};

type AssistantKind = "chat" | "utility";

type Assistant = {
  id: string;
  name: string;
  description: string;
  kind: AssistantKind;
  apiProfileName: string;
  model: string;
  prompt: string;
  initialMessage: string;
  enabled: boolean;
};

type AssistantFieldKey =
  | "name"
  | "description"
  | "kind"
  | "apiProfileName"
  | "model"
  | "prompt"
  | "initialMessage"
  | "enabled";

type AssistantField = {
  key: AssistantFieldKey;
  label: string;
  control: "text" | "textarea" | "select" | "checkbox";
  helper?: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

const defaultAssistant: Assistant = {
  id: "architect",
  name: "架构助手",
  description: "用于架构讨论、技术路线确认和上下文机制设计。",
  kind: "chat",
  apiProfileName: "MNAPI",
  model: "gpt-5.4",
  prompt: "你是一个务实的软件架构助手，优先给出可落地的设计。",
  initialMessage: "我会根据当前对话上下文协助推进实现。",
  enabled: true,
};

const initialConversations: Conversation[] = [
  {
    id: "local-context",
    title: "本地上下文机制",
    summary: "store:false、本地投影、checkpoint、cache estimate",
    archived: false,
  },
  {
    id: "mobile-preview",
    title: "手机预览 contents",
    summary: "文件选择、图片预览、权限差异",
    archived: false,
  },
  {
    id: "assistant-routes",
    title: "助手与模型配置",
    summary: "API profile、chat/utility assistant、模型绑定",
    archived: false,
  },
];

const initialMessages: Message[] = [
  {
    id: "m1",
    conversationId: "local-context",
    role: "user",
    label: "用户",
    text: "放弃 store 方案，首版只使用本地上下文构建。",
  },
  {
    id: "m2",
    conversationId: "local-context",
    role: "assistant",
    label: "架构助手 · gpt-5.4",
    text: "已切换为 store:false 基线。每次请求由本地 ContextProjection 构建，provider 返回的 ID 只保留为诊断字段。",
  },
  {
    id: "m3",
    conversationId: "local-context",
    role: "user",
    label: "用户",
    text: "调试模式需要显示发送前 cache 估算和发送后 usage。",
  },
  {
    id: "m4",
    conversationId: "local-context",
    role: "assistant",
    label: "架构助手 · gpt-5.4",
    text: "调试面板区分 estimate 和 observed：发送前显示 potentialCacheableRate，发送后显示 cachedInputTokens / inputTokens。",
  },
];

const initialAssistants: Assistant[] = [
  defaultAssistant,
  {
    id: "research",
    name: "研究助手",
    description: "用于资料整理、方案比较和长问题拆解。",
    kind: "chat",
    apiProfileName: "MNAPI",
    model: "gpt-5.4-mini",
    prompt: "你是研究型助手，先澄清事实边界，再给出结论。",
    initialMessage: "我可以帮助梳理资料和比较方案。",
    enabled: true,
  },
  {
    id: "compact",
    name: "压缩助手",
    description: "功能助手，用于后续上下文压缩和摘要生成。",
    kind: "utility",
    apiProfileName: "MNAPI",
    model: "gpt-5.4-mini",
    prompt: "你只输出结构化摘要，不参与普通聊天。",
    initialMessage: "",
    enabled: true,
  },
];

const assistantFields: AssistantField[] = [
  {
    key: "name",
    label: "助手名称",
    control: "text",
    placeholder: "例如：架构助手",
    helper: "显示在聊天页和消息来源快照中的名称。",
  },
  {
    key: "description",
    label: "描述",
    control: "text",
    placeholder: "说明这个助手适合处理什么任务",
  },
  {
    key: "kind",
    label: "用途",
    control: "select",
    options: [
      { label: "聊天助手", value: "chat" },
      { label: "功能助手", value: "utility" },
    ],
  },
  {
    key: "apiProfileName",
    label: "API Profile",
    control: "text",
    placeholder: "例如：MNAPI",
  },
  {
    key: "model",
    label: "模型",
    control: "text",
    placeholder: "例如：gpt-5.4",
  },
  {
    key: "prompt",
    label: "初始 Prompt",
    control: "textarea",
    helper: "仅作用于该助手；对话上下文仍由本地共享。",
  },
  {
    key: "initialMessage",
    label: "初始消息",
    control: "textarea",
    helper: "后续新建对话时可用于助手开场白。",
  },
  {
    key: "enabled",
    label: "启用",
    control: "checkbox",
  },
];

const diagnostics = [
  ["输入估算", "12.8k tokens"],
  ["可缓存前缀", "42%"],
  ["预计命中", "medium · 38%"],
  ["观测命中", "unknown"],
];

type PwaNotice = "offline-ready" | "update-available" | null;

const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function App() {
  const [conversations, setConversations] =
    useState<Conversation[]>(initialConversations);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [assistants, setAssistants] = useState<Assistant[]>(initialAssistants);
  const [activeConversationId, setActiveConversationId] =
    useState("local-context");
  const [activeAssistantId, setActiveAssistantId] = useState(
    defaultAssistant.id,
  );
  const [editingAssistantId, setEditingAssistantId] = useState(
    defaultAssistant.id,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(true);
  const [draft, setDraft] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [pwaNotice, setPwaNotice] = useState<PwaNotice>(null);
  const responseTimerRef = useRef<number | null>(null);

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
    return () => {
      if (responseTimerRef.current) {
        window.clearTimeout(responseTimerRef.current);
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
              setSettingsOpen(false);
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
                onClick={() => setSettingsOpen(false)}
              >
                ×
              </button>
            </header>

            <section className="settings-summary" aria-label="设置概览">
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
