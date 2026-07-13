export type Conversation = {
  id: string;
  title: string;
  summary: string;
  archived: boolean;
};

export type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  label: string;
  text: string;
  status?: "streaming" | "stopped" | "complete";
};

export type AssistantKind = "chat" | "utility";

export type Assistant = {
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

export type AssistantFieldKey =
  | "name"
  | "description"
  | "kind"
  | "apiProfileName"
  | "model"
  | "prompt"
  | "initialMessage"
  | "enabled";

export type AssistantField = {
  key: AssistantFieldKey;
  label: string;
  control: "text" | "textarea" | "select" | "checkbox";
  helper?: string;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
};

export type AppSettings = {
  id: "app";
  schemaVersion: 1;
  activeConversationId: string;
  activeAssistantId: string;
  editingAssistantId: string;
  debugEnabled: boolean;
  lastSuccessfulExportAt?: string;
  storagePersisted?: boolean | null;
  storageUsage?: number;
  storageQuota?: number;
  updatedAt: string;
};

export type StorageInfo = {
  persisted: boolean | null;
  usage?: number;
  quota?: number;
};

export type LocalDataSnapshot = {
  settings: AppSettings;
  assistants: Assistant[];
  conversations: Conversation[];
  messages: Message[];
};

export type SaveStatus = "loading" | "unsaved" | "saving" | "saved" | "failed";

export const DATABASE_SCHEMA_VERSION = 1;

export const defaultAssistant: Assistant = {
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

export const initialConversations: Conversation[] = [
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

export const initialMessages: Message[] = [
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

export const initialAssistants: Assistant[] = [
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

export const assistantFields: AssistantField[] = [
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

export const diagnostics = [
  ["输入估算", "12.8k tokens"],
  ["可缓存前缀", "42%"],
  ["预计命中", "medium · 38%"],
  ["观测命中", "unknown"],
];

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const createInitialSettings = (
  now = new Date().toISOString(),
): AppSettings => ({
  id: "app",
  schemaVersion: DATABASE_SCHEMA_VERSION,
  activeConversationId: "local-context",
  activeAssistantId: defaultAssistant.id,
  editingAssistantId: defaultAssistant.id,
  debugEnabled: true,
  storagePersisted: null,
  updatedAt: now,
});

export const createInitialSnapshot = (): LocalDataSnapshot => ({
  settings: createInitialSettings(),
  assistants: initialAssistants,
  conversations: initialConversations,
  messages: initialMessages,
});
