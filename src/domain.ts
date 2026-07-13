export type Conversation = {
  id: string;
  title: string;
  summary: string;
  archived: boolean;
};

export type ResponseUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
};

export type MessageSourceSnapshot = {
  assistantId: string;
  assistantName: string;
  assistantDescription: string;
  apiProfileId: string;
  apiProfileName: string;
  modelId: string;
  modelName: string;
  modelDescription: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  label: string;
  text: string;
  createdAt: string;
  status?: "streaming" | "stopped" | "complete" | "error";
  source?: MessageSourceSnapshot;
  providerResponseId?: string;
  usage?: ResponseUsage;
};

export type AssistantKind = "chat" | "utility";
export type ThemeMode = "system" | "light" | "dark";
export type ApiProtocol = "openai-responses";

export type ModelDefinition = {
  id: string;
  name: string;
  description: string;
  contextWindow?: number;
  enabled: boolean;
};

export type ApiProfile = {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  apiKey: string;
  protocol: ApiProtocol;
  enabled: boolean;
  models: ModelDefinition[];
};

export type ModelRef = {
  apiProfileId: string;
  modelId: string;
};

export type AssistantModelBinding = ModelRef & {
  enabled: boolean;
  isDefault: boolean;
  apiProfileNameSnapshot: string;
  modelNameSnapshot: string;
  modelDescriptionSnapshot: string;
};

export type Assistant = {
  id: string;
  name: string;
  description: string;
  kind: AssistantKind;
  modelBindings: AssistantModelBinding[];
  prompt: string;
  initialMessage: string;
  enabled: boolean;

  /**
   * Legacy v1 fields. They are kept optional so old IndexedDB records and
   * archives can be migrated without losing the user's previous route choice.
   */
  apiProfileName?: string;
  model?: string;
};

export type AssistantFieldKey =
  "name" | "description" | "kind" | "prompt" | "initialMessage" | "enabled";

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
  schemaVersion: 4;
  activeConversationId: string;
  activeAssistantId: string;
  activeModelRef: ModelRef;
  editingAssistantId: string;
  themeMode: ThemeMode;
  streamingEnabled: boolean;
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
  apiProfiles: ApiProfile[];
  assistants: Assistant[];
  conversations: Conversation[];
  messages: Message[];
};

export type SaveStatus = "loading" | "unsaved" | "saving" | "saved" | "failed";

export const DATABASE_SCHEMA_VERSION = 4;

export const MNAPI_PROFILE_ID = "mnapi";
export const DEFAULT_MODEL_REF: ModelRef = {
  apiProfileId: MNAPI_PROFILE_ID,
  modelId: "gpt-5.4-codex-high",
};

export const modelRefKey = (ref: ModelRef) =>
  `${ref.apiProfileId}::${ref.modelId}`;

export const parseModelRefKey = (key: string): ModelRef => {
  const [apiProfileId, ...modelParts] = key.split("::");
  return {
    apiProfileId: apiProfileId || DEFAULT_MODEL_REF.apiProfileId,
    modelId: modelParts.join("::") || DEFAULT_MODEL_REF.modelId,
  };
};

const mnapiBinding = (
  modelId: string,
  isDefault = false,
): AssistantModelBinding => ({
  apiProfileId: MNAPI_PROFILE_ID,
  modelId,
  enabled: true,
  isDefault,
  apiProfileNameSnapshot: "MNAPI",
  modelNameSnapshot: modelId,
  modelDescriptionSnapshot: "MNAPI 预设模型路由",
});

export const initialApiProfiles: ApiProfile[] = [
  {
    id: MNAPI_PROFILE_ID,
    name: "MNAPI",
    description:
      "复用 start_mnapi_codex 的 OpenAI-compatible Responses 中转站预设；API key 需要在本机设置页填写。",
    baseUrl: "https://api.mnapi.com/v1",
    apiKey: "",
    protocol: "openai-responses",
    enabled: true,
    models: [
      {
        id: "gpt-5.4-codex-high",
        name: "gpt-5.4-codex-high",
        description:
          "来自 start_mnapi_codex 的默认模型；MNAPI 通过模型名后缀表达 high 推理强度。",
        contextWindow: 128000,
        enabled: true,
      },
      {
        id: "gpt-5.4-codex-medium",
        name: "gpt-5.4-codex-medium",
        description: "MNAPI 推理强度 medium 变体，需以网关实际支持为准。",
        contextWindow: 128000,
        enabled: true,
      },
      {
        id: "gpt-5.4-codex-low",
        name: "gpt-5.4-codex-low",
        description: "MNAPI 推理强度 low 变体，需以网关实际支持为准。",
        contextWindow: 128000,
        enabled: true,
      },
      {
        id: "gpt-5.4",
        name: "gpt-5.4",
        description: "通用 GPT-5.4 路由，供非 Codex 场景或网关兼容路由使用。",
        contextWindow: 128000,
        enabled: true,
      },
      {
        id: "gpt-5.4-mini",
        name: "gpt-5.4-mini",
        description: "轻量模型预设，适合研究整理、摘要和功能助手。",
        contextWindow: 128000,
        enabled: true,
      },
    ],
  },
];

export const defaultAssistant: Assistant = {
  id: "architect",
  name: "架构助手",
  description: "用于架构讨论、技术路线确认和上下文机制设计。",
  kind: "chat",
  modelBindings: [
    mnapiBinding("gpt-5.4-codex-high", true),
    mnapiBinding("gpt-5.4-codex-medium"),
    mnapiBinding("gpt-5.4"),
  ],
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
    createdAt: "2026-07-13T00:00:00.000Z",
  },
  {
    id: "m2",
    conversationId: "local-context",
    role: "assistant",
    label: "架构助手 · gpt-5.4-codex-high",
    text: "已切换为 store:false 基线。每次请求由本地 ContextProjection 构建，provider 返回的 ID 只保留为诊断字段。",
    createdAt: "2026-07-13T00:00:01.000Z",
  },
  {
    id: "m3",
    conversationId: "local-context",
    role: "user",
    label: "用户",
    text: "调试模式需要显示发送前 cache 估算和发送后 usage。",
    createdAt: "2026-07-13T00:00:02.000Z",
  },
  {
    id: "m4",
    conversationId: "local-context",
    role: "assistant",
    label: "架构助手 · gpt-5.4-codex-high",
    text: "调试面板区分 estimate 和 observed：发送前显示 potentialCacheableRate，发送后显示 cachedInputTokens / inputTokens。",
    createdAt: "2026-07-13T00:00:03.000Z",
  },
];

export const initialAssistants: Assistant[] = [
  defaultAssistant,
  {
    id: "research",
    name: "研究助手",
    description: "用于资料整理、方案比较和长问题拆解。",
    kind: "chat",
    modelBindings: [
      mnapiBinding("gpt-5.4-mini", true),
      mnapiBinding("gpt-5.4"),
      mnapiBinding("gpt-5.4-codex-medium"),
    ],
    prompt: "你是研究型助手，先澄清事实边界，再给出结论。",
    initialMessage: "我可以帮助梳理资料和比较方案。",
    enabled: true,
  },
  {
    id: "compact",
    name: "压缩助手",
    description: "功能助手，用于后续上下文压缩和摘要生成。",
    kind: "utility",
    modelBindings: [mnapiBinding("gpt-5.4-mini", true)],
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
    key: "prompt",
    label: "初始 Prompt",
    control: "textarea",
    helper: "仅作用于该助手；对话上下文仍由本地共享构建。",
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

export const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const createInitialSettings = (
  now = new Date().toISOString(),
): AppSettings => ({
  id: "app",
  schemaVersion: DATABASE_SCHEMA_VERSION,
  activeConversationId: "local-context",
  activeAssistantId: defaultAssistant.id,
  activeModelRef: DEFAULT_MODEL_REF,
  editingAssistantId: defaultAssistant.id,
  themeMode: "system",
  streamingEnabled: true,
  debugEnabled: true,
  storagePersisted: null,
  updatedAt: now,
});

export const createInitialSnapshot = (): LocalDataSnapshot => ({
  settings: createInitialSettings(),
  apiProfiles: initialApiProfiles,
  assistants: initialAssistants,
  conversations: initialConversations,
  messages: initialMessages,
});
