import {
  Archive,
  Bot,
  ChevronsUpDown,
  MessageSquarePlus,
  PanelLeft,
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

type Assistant = {
  id: string;
  label: string;
  model: string;
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

const assistants: Assistant[] = [
  { id: "architect", label: "架构助手", model: "gpt-5.4" },
  { id: "compact", label: "压缩助手", model: "gpt-5.4-mini" },
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
  const [activeConversationId, setActiveConversationId] =
    useState("local-context");
  const [activeAssistantIndex, setActiveAssistantIndex] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(true);
  const [draft, setDraft] = useState("");
  const [conversationSearch, setConversationSearch] = useState("");
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [pwaNotice, setPwaNotice] = useState<PwaNotice>(null);
  const responseTimerRef = useRef<number | null>(null);

  const activeAssistant = assistants[activeAssistantIndex];
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
      label: `${activeAssistant.label} · ${activeAssistant.model}`,
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
          <button type="button" onClick={() => setSettingsOpen(true)}>
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
          <button
            className="assistant-switch"
            type="button"
            onClick={() =>
              setActiveAssistantIndex(
                (current) => (current + 1) % assistants.length,
              )
            }
          >
            <Bot size={18} />
            {activeAssistant.label}
            <ChevronsUpDown size={16} />
          </button>
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
            <div className="settings-list">
              <div className="settings-row">
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
              <div className="settings-row">
                <span>API Profiles</span>
                <strong>1</strong>
              </div>
              <div className="settings-row">
                <span>聊天助手</span>
                <strong>{assistants.length}</strong>
              </div>
              <div className="settings-row">
                <span>当前助手</span>
                <strong>{activeAssistant.label}</strong>
              </div>
              <div className="settings-row">
                <span>功能助手</span>
                <strong>1</strong>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
