export type Conversation = {
  id: string;
  title: string;
  summary: string;
  archived: boolean;
  contextSummaries?: ContextSummaryRecord[];
  activeContextSummaryId?: string;
};

export type ContextSummaryKind = "rolling" | "segment" | "merged";

export type ContextSummaryStatus = "active" | "superseded";

export type ContextSummaryFrameworkSection = {
  id: string;
  title: string;
  instruction: string;
  required: boolean;
};

export type ContextSummaryFramework = {
  id: string;
  name: string;
  description: string;
  schemaVersion: number;
  sections: ContextSummaryFrameworkSection[];
};

export type ContextProfileDimensionOverride = {
  dimensionId: string;
  enabled?: boolean;
  titleOverride?: string;
  instruction: string;
};

export type ContextProfile = {
  id: string;
  name: string;
  description: string;
  dimensionOverrides: ContextProfileDimensionOverride[];
};

export type ContextSummaryRecord = {
  id: string;
  kind: ContextSummaryKind;
  status: ContextSummaryStatus;
  schemaVersion: number;
  text: string;
  boundaryMessageId: string;
  coveredMessageCount: number;
  retainedRawMessageCount: number;
  createdAt: string;
  updatedAt: string;
  previousSummaryId?: string;
  source?: MessageSourceSnapshot;
  frameworkId: string;
  frameworkNameSnapshot: string;
  frameworkSectionsSnapshot: ContextSummaryFrameworkSection[];
  contextProfileId?: string;
  contextProfileNameSnapshot?: string;
  contextProfileDimensionOverridesSnapshot?: ContextProfileDimensionOverride[];
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
  completedAt?: string;
  elapsedMs?: number;
  status?: "streaming" | "stopped" | "complete" | "error";
  source?: MessageSourceSnapshot;
  providerResponseId?: string;
  usage?: ResponseUsage;
};

export type AssistantKind = "chat" | "utility";
export type UtilityAssistantModelStrategy = "follow-conversation" | "fixed";
export type ThemeMode = "system" | "light" | "dark";
export type LayoutMode = "auto" | "mobile" | "desktop";
export type ComposerSubmitMode = "enter-send" | "ctrl-enter-send";
export type ApiProtocol = "openai-responses" | "openai-chat-completions";

export type UtilityAssistantFeatureRefs = {
  contextSummaryAssistantId: string;
  contextCompressionAssistantId: string;
};

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

export type ModelProbeMinorTenthsDimension = {
  type: "minorTenths";
  majors: string[];
  from?: number;
  to?: number;
  separator?: "." | "-";
};

export type ModelProbeDimensionValue =
  | string
  | string[]
  | ModelProbeMinorTenthsDimension
  | { values: ModelProbeDimensionValue[] };

export type ModelProbeRule = {
  id: string;
  template: string;
  dimensions: Record<string, ModelProbeDimensionValue>;
  enabled: boolean;
  description: string;
};

export type ModelProbeGroup = {
  id: string;
  name: string;
  description: string;
  rules: ModelProbeRule[];
};

export type ModelProbeSettings = {
  groups: ModelProbeGroup[];
  editingGroupId: string;
  timeoutMs: number;
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
  utilityModelStrategy?: UtilityAssistantModelStrategy;
  modelBindings: AssistantModelBinding[];
  contextProfileId?: string;
  prompt: string;
  initialMessage: string;
  enabled: boolean;
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
  schemaVersion: typeof DATABASE_SCHEMA_VERSION;
  activeConversationId: string;
  activeAssistantId: string;
  activeModelRef: ModelRef;
  editingAssistantId: string;
  themeMode: ThemeMode;
  layoutMode: LayoutMode;
  streamingEnabled: boolean;
  composerSubmitMode: ComposerSubmitMode;
  contextSummaryRawTailMessages: number;
  contextSummaryAutoMessageInterval: number;
  debugEnabled: boolean;
  apiProfileOrder: string[];
  assistantOrder: string[];
  utilityAssistantRefs: UtilityAssistantFeatureRefs;
  modelProbeSettings: ModelProbeSettings;
  contextSummaryFramework: ContextSummaryFramework;
  contextProfiles: ContextProfile[];
  editingContextProfileId: string;
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

export const DATABASE_SCHEMA_VERSION = 10;

export const DEFAULT_PROFILE_ID = "default-profile";
export const DEFAULT_MODEL_ID = "default-model";
export const CONTEXT_SUMMARY_ASSISTANT_ID = "context-summary-gpt54";
export const CONTEXT_COMPRESSION_ASSISTANT_ID = "compact";
export const DEFAULT_CONTEXT_SUMMARY_FRAMEWORK_ID = "default-context-summary";
export const DEFAULT_CONTEXT_PROFILE_ID = "general-context";
export const DEFAULT_CONTEXT_SUMMARY_RAW_TAIL_MESSAGES = 8;
export const DEFAULT_CONTEXT_SUMMARY_AUTO_MESSAGE_INTERVAL = 8;
export const DEFAULT_MODEL_PROBE_GROUP_ID = "grok";
export const DEFAULT_MODEL_REF: ModelRef = {
  apiProfileId: DEFAULT_PROFILE_ID,
  modelId: DEFAULT_MODEL_ID,
};

export const defaultUtilityAssistantRefs: UtilityAssistantFeatureRefs = {
  contextSummaryAssistantId: CONTEXT_SUMMARY_ASSISTANT_ID,
  contextCompressionAssistantId: CONTEXT_COMPRESSION_ASSISTANT_ID,
};

export const defaultModelProbeSettings: ModelProbeSettings = {
  groups: [
    {
      id: "gpt",
      name: "GPT 5.x",
      description: "GPT 5 大版本探测；包含裸模型、mini/pro、Sol/Terra/Luna。",
      rules: [
        {
          id: "gpt-family",
          template: "gpt-{version}{arg1}",
          dimensions: {
            version: { type: "minorTenths", majors: ["5"], from: 4, to: 6 },
            arg1: ["", "pro", "mini", "sol", "terra", "luna"],
          },
          enabled: true,
          description: "",
        },
      ],
    },
    {
      id: "gpt-codex",
      name: "GPT Codex 5.x",
      description:
        "GPT 5 Codex 大版本探测；按 codex 后缀和 high/medium/low 强度展开。",
      rules: [
        {
          id: "gpt-codex",
          template: "gpt-{version}{arg1}{arg2}",
          dimensions: {
            version: { type: "minorTenths", majors: ["5"], from: 4, to: 6 },
            arg1: ["codex"],
            arg2: ["high", "medium", "low"],
          },
          enabled: true,
          description: "",
        },
      ],
    },
    {
      id: "grok",
      name: "Grok 4.x",
      description:
        "Grok 4 主流文本模型探测；覆盖 fast、reasoning、thinking，忽略 :origin 等特殊别名。",
      rules: [
        {
          id: "grok-4x-mainstream",
          template: "grok-{version}{arg1}",
          dimensions: {
            version: { type: "minorTenths", majors: ["4"], from: 0, to: 3 },
            arg1: ["", "fast", "reasoning", "fast-reasoning", "thinking"],
          },
          enabled: true,
          description: "",
        },
      ],
    },
    {
      id: "gemini",
      name: "Gemini 3.x",
      description:
        "Gemini 3 大版本探测；保留截图里出现的 preview / thinking 主流后缀。",
      rules: [
        {
          id: "gemini-mainstream",
          template: "gemini-{version}{arg1}{arg2}{arg3}",
          dimensions: {
            version: { type: "minorTenths", majors: ["3"], from: 0, to: 5 },
            arg1: ["pro", "flash", "flash-lite"],
            arg2: ["preview"],
            arg3: ["", "thinking", "thinking-128"],
          },
          enabled: true,
          description: "",
        },
      ],
    },
    {
      id: "qwen",
      name: "Qwen 3.x",
      description: "Qwen 3 大版本探测；仅保留 max/plus/flash 主流后缀。",
      rules: [
        {
          id: "qwen-3x",
          template: "qwen{version}{arg1}",
          dimensions: {
            version: { type: "minorTenths", majors: ["3"], from: 6, to: 7 },
            arg1: ["max", "plus", "flash"],
          },
          enabled: true,
          description: "",
        },
      ],
    },
    {
      id: "glm",
      name: "GLM 4.x / 5.x",
      description: "GLM 4 和 5 大版本探测，保留 air / flash 后缀。",
      rules: [
        {
          id: "glm-mainstream",
          template: "glm-{version}{arg1}",
          dimensions: {
            version: {
              type: "minorTenths",
              majors: ["4", "5"],
              from: 2,
              to: 7,
            },
            arg1: ["", "air", "flash"],
          },
          enabled: true,
          description: "",
        },
      ],
    },
  ],
  editingGroupId: DEFAULT_MODEL_PROBE_GROUP_ID,
  timeoutMs: 3000,
};

export const defaultContextSummaryFramework: ContextSummaryFramework = {
  id: DEFAULT_CONTEXT_SUMMARY_FRAMEWORK_ID,
  name: "默认上下文总结框架",
  description:
    "用于单对话内继续上下文的结构化总结框架；后续可扩展为用户可编辑分类。",
  schemaVersion: 1,
  sections: [
    {
      id: "strict_memory",
      title: "严格记忆",
      instruction:
        "只记录用户明确确认的需求、硬约束、长期偏好、必须遵守的规则和不可丢失结论。",
      required: true,
    },
    {
      id: "precise_facts",
      title: "精确事实",
      instruction:
        "记录可精确引用的事实、字段、路径、版本、模型、配置、数值、角色属性和世界规则。禁止保存 API key 原文。",
      required: false,
    },
    {
      id: "fuzzy_memory",
      title: "模糊记忆",
      instruction:
        "记录尚未完全确定但有助于理解方向的偏好、倾向、猜测、关系温度、情绪趋势和需要后续验证的背景。",
      required: false,
    },
    {
      id: "exploration_log",
      title: "探索记录",
      instruction:
        "记录已尝试的方法、观察到的结果、失败原因、排除项、随机事件、灵感分支和未固化素材，避免重复探索。",
      required: true,
    },
    {
      id: "current_state",
      title: "当前状态",
      instruction:
        "记录已经完成的事项、当前场景、即时心情、正在进行的事件、当前阻塞点、下一步计划和待用户确认的问题。",
      required: true,
    },
  ],
};

export const defaultContextProfile: ContextProfile = {
  id: DEFAULT_CONTEXT_PROFILE_ID,
  name: "通用上下文",
  description: "默认上下文设定。保留系统五维度含义，不添加特定业务重载。",
  dimensionOverrides: [],
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

const defaultBinding = (isDefault = false): AssistantModelBinding => ({
  apiProfileId: DEFAULT_PROFILE_ID,
  modelId: DEFAULT_MODEL_ID,
  enabled: true,
  isDefault,
  apiProfileNameSnapshot: "默认连接",
  modelNameSnapshot: "默认模型",
  modelDescriptionSnapshot: "请在设置页编辑模型 ID 和连接信息。",
});

export const initialApiProfiles: ApiProfile[] = [
  {
    id: DEFAULT_PROFILE_ID,
    name: "默认连接",
    description: "",
    baseUrl: "",
    apiKey: "",
    protocol: "openai-responses",
    enabled: true,
    models: [
      {
        id: DEFAULT_MODEL_ID,
        name: "默认模型",
        description: "",
        contextWindow: 128000,
        enabled: true,
      },
    ],
  },
];

export const defaultAssistant: Assistant = {
  id: "architect",
  name: "默认助手",
  description: "",
  kind: "chat",
  modelBindings: [defaultBinding(true)],
  contextProfileId: DEFAULT_CONTEXT_PROFILE_ID,
  prompt: "",
  initialMessage: "",
  enabled: true,
};

export const contextSummaryAssistant: Assistant = {
  id: CONTEXT_SUMMARY_ASSISTANT_ID,
  name: "总结助手",
  description:
    "内置功能助手预设：为单个对话生成可继续使用的上下文总结，不参与普通聊天。",
  kind: "utility",
  utilityModelStrategy: "follow-conversation",
  modelBindings: [defaultBinding(true)],
  contextProfileId: DEFAULT_CONTEXT_PROFILE_ID,
  prompt:
    "你是 MobileChat 的上下文总结助手。你的任务是把一个单独对话的旧消息整理成后续请求可使用的上下文总结。只保留对继续对话有用的信息：目标、已确认决策、约束、待办、术语定义、重要代码/配置发现、未解决问题。不要新增事实，不要评价，不要输出寒暄。输出中文 Markdown，结构清晰但尽量紧凑。",
  initialMessage: "",
  enabled: true,
};

export const initialConversations: Conversation[] = [
  {
    id: "initial-conversation",
    title: "新对话 1",
    summary: "",
    archived: false,
  },
];

export const initialMessages: Message[] = [];

export const initialAssistants: Assistant[] = [
  defaultAssistant,
  contextSummaryAssistant,
  {
    id: "compact",
    name: "压缩助手",
    description: "功能助手，用于后续 /compact 风格上下文压缩。",
    kind: "utility",
    utilityModelStrategy: "follow-conversation",
    modelBindings: [defaultBinding(true)],
    contextProfileId: DEFAULT_CONTEXT_PROFILE_ID,
    prompt: "你只输出结构化压缩结果，不参与普通聊天。",
    initialMessage: "",
    enabled: true,
  },
];

export const assistantFields: AssistantField[] = [
  {
    key: "name",
    label: "助手名称",
    control: "text",
    placeholder: "例如：默认助手",
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
  activeConversationId: "initial-conversation",
  activeAssistantId: defaultAssistant.id,
  activeModelRef: DEFAULT_MODEL_REF,
  editingAssistantId: defaultAssistant.id,
  themeMode: "system",
  layoutMode: "auto",
  streamingEnabled: true,
  composerSubmitMode: "enter-send",
  contextSummaryRawTailMessages: DEFAULT_CONTEXT_SUMMARY_RAW_TAIL_MESSAGES,
  contextSummaryAutoMessageInterval:
    DEFAULT_CONTEXT_SUMMARY_AUTO_MESSAGE_INTERVAL,
  debugEnabled: true,
  apiProfileOrder: initialApiProfiles.map((profile) => profile.id),
  assistantOrder: initialAssistants.map((assistant) => assistant.id),
  utilityAssistantRefs: defaultUtilityAssistantRefs,
  modelProbeSettings: defaultModelProbeSettings,
  contextSummaryFramework: defaultContextSummaryFramework,
  contextProfiles: [defaultContextProfile],
  editingContextProfileId: defaultContextProfile.id,
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
