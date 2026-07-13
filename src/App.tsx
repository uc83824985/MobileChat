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
import { useEffect, useMemo, useState } from "react";
import "./App.css";

const conversations = [
  {
    id: "local-context",
    title: "本地上下文机制",
    summary: "store:false、本地投影、checkpoint、cache estimate",
    active: true,
  },
  {
    id: "mobile-preview",
    title: "手机预览 contents",
    summary: "文件选择、图片预览、权限差异",
    active: false,
  },
  {
    id: "assistant-routes",
    title: "助手与模型配置",
    summary: "API profile、chat/utility assistant、模型绑定",
    active: false,
  },
];

const messages = [
  {
    id: "m1",
    role: "user",
    label: "用户",
    text: "放弃 store 方案，首版只使用本地上下文构建。",
  },
  {
    id: "m2",
    role: "assistant",
    label: "架构助手 · gpt-5.4",
    text: "已切换为 store:false 基线。每次请求由本地 ContextProjection 构建，provider 返回的 ID 只保留为诊断字段。",
  },
  {
    id: "m3",
    role: "user",
    label: "用户",
    text: "调试模式需要显示发送前 cache 估算和发送后 usage。",
  },
  {
    id: "m4",
    role: "assistant",
    label: "架构助手 · gpt-5.4",
    text: "调试面板区分 estimate 和 observed：发送前显示 potentialCacheableRate，发送后显示 cachedInputTokens / inputTokens。",
  },
];

const diagnostics = [
  ["输入估算", "12.8k tokens"],
  ["可缓存前缀", "42%"],
  ["预计命中", "medium · 38%"],
  ["观测命中", "unknown"],
];

type PwaNotice = "offline-ready" | "update-available" | null;

function App() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(true);
  const [pwaNotice, setPwaNotice] = useState<PwaNotice>(null);
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.active),
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

      <aside className={`conversation-rail ${drawerOpen ? "open" : ""}`}>
        <header className="rail-header">
          <div>
            <p className="eyebrow">MobileChat</p>
            <h1>对话</h1>
          </div>
          <button className="icon-button" type="button" aria-label="新建对话">
            <MessageSquarePlus size={20} />
          </button>
        </header>

        <label className="search-box">
          <Search size={18} />
          <input placeholder="搜索标题或摘要" />
        </label>

        <nav className="conversation-list" aria-label="对话列表">
          {conversations.map((conversation) => (
            <button
              className={`conversation-item ${
                conversation.active ? "selected" : ""
              }`}
              key={conversation.id}
              type="button"
            >
              <span>{conversation.title}</span>
              <small>{conversation.summary}</small>
            </button>
          ))}
        </nav>

        <footer className="rail-footer">
          <button type="button">
            <Archive size={18} />
            归档
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
            <p>{activeConversation?.title}</p>
            <span>{activeConversation?.summary}</span>
          </div>
          <button className="assistant-switch" type="button">
            <Bot size={18} />
            架构助手
            <ChevronsUpDown size={16} />
          </button>
        </header>

        <div className="message-thread">
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="message-label">{message.label}</div>
              <p>{message.text}</p>
            </article>
          ))}
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
          <button className="icon-button" type="button" aria-label="停止">
            <StopCircle size={20} />
          </button>
          <textarea rows={1} placeholder="输入消息" />
          <button className="send-button" type="button" aria-label="发送">
            <Send size={18} />
          </button>
        </footer>
      </section>

      {settingsOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="settings-panel" role="dialog" aria-modal="true">
            <header>
              <div>
                <p className="eyebrow">Settings</p>
                <h2>设置</h2>
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
              <strong>2</strong>
            </div>
            <div className="settings-row">
              <span>功能助手</span>
              <strong>1</strong>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
