import {
  Archive,
  Bot,
  Check,
  Database,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  MessageSquarePlus,
  Palette,
  PanelLeft,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Server,
  Settings,
  SlidersHorizontal,
  StopCircle,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  useCallback,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
} from "react";
import { requestResponsesChat } from "./api/responsesClient";
import "./App.css";
import {
  type ApiProfile,
  type ApiProtocol,
  type Assistant,
  type AssistantFieldKey,
  type AssistantModelBinding,
  assistantFields,
  type ComposerSubmitMode,
  type Conversation,
  type ContextProfile,
  type ContextProfileDimensionOverride,
  type ContextSummaryFramework,
  type ContextSummaryRecord,
  CONTEXT_SUMMARY_ASSISTANT_ID,
  createId,
  createInitialSnapshot,
  defaultContextProfile,
  defaultContextSummaryFramework,
  DEFAULT_CONTEXT_SUMMARY_AUTO_MESSAGE_INTERVAL,
  DEFAULT_CONTEXT_SUMMARY_RAW_TAIL_MESSAGES,
  DEFAULT_MODEL_REF,
  defaultAssistant,
  type LocalDataSnapshot,
  type LayoutMode,
  type Message,
  type ModelDefinition,
  type ModelRef,
  modelRefKey,
  parseModelRefKey,
  type ResponseUsage,
  type SaveStatus,
  type StorageInfo,
  type ThemeMode,
  type UtilityAssistantModelStrategy,
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
type CustomSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};
type ResolvedModel = {
  apiProfile: ApiProfile;
  model: ModelDefinition;
  ref: ModelRef;
  key: string;
};

const UI_PREFERENCES_STORAGE_KEY = "mobilechat:ui-preferences";
const AUTOSAVE_DELAY_MS = 400;
const SCROLL_EDGE_THRESHOLD_PX = 12;
const COMPOSER_MAX_HEIGHT_PX = 220;
const PANEL_SWIPE_EDGE_GUARD_PX = 32;
const PANEL_SWIPE_TRIGGER_PX = 64;
const PANEL_SWIPE_VERTICAL_LIMIT_PX = 56;
const PANEL_SWIPE_IGNORE_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='combobox']",
  ".composer",
  ".custom-select",
  ".conversation-rail",
].join(",");

const isThemeMode = (value: unknown): value is ThemeMode =>
  value === "system" || value === "light" || value === "dark";

const isLayoutMode = (value: unknown): value is LayoutMode =>
  value === "auto" || value === "mobile" || value === "desktop";

const getViewportIsMobile = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(max-width: 820px)").matches;

const getElementTarget = (target: EventTarget | null) =>
  target instanceof Element ? target : null;

const isNearHorizontalViewportEdge = (clientX: number) => {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    clientX <= PANEL_SWIPE_EDGE_GUARD_PX ||
    window.innerWidth - clientX <= PANEL_SWIPE_EDGE_GUARD_PX
  );
};

const sortMessagesByCreatedAt = (messages: Message[]) =>
  [...messages].sort(compareMessagesByCreatedAt);

const readBootUiPreferences = ():
  { themeMode?: ThemeMode; layoutMode?: LayoutMode } | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? "{}",
    ) as { themeMode?: unknown; layoutMode?: unknown };
    return {
      themeMode: isThemeMode(parsed.themeMode) ? parsed.themeMode : undefined,
      layoutMode: isLayoutMode(parsed.layoutMode)
        ? parsed.layoutMode
        : undefined,
    };
  } catch {
    return undefined;
  }
};

const createBootSnapshot = (): LocalDataSnapshot => {
  const snapshot = createInitialSnapshot();
  const uiPreferences = readBootUiPreferences();
  return {
    ...snapshot,
    settings: {
      ...snapshot.settings,
      themeMode: uiPreferences?.themeMode ?? snapshot.settings.themeMode,
      layoutMode: uiPreferences?.layoutMode ?? snapshot.settings.layoutMode,
    },
  };
};

const createEmptyApiProfile = (index: number): ApiProfile => ({
  id: createId("api-profile"),
  name: `连接 ${index}`,
  description: "",
  baseUrl: "",
  apiKey: "",
  protocol: "openai-responses",
  enabled: true,
  models: [
    {
      id: "new-model",
      name: "新模型",
      description: "",
      contextWindow: 128000,
      enabled: true,
    },
  ],
});

const createEmptyAssistant = (
  index: number,
  baseModel?: ResolvedModel,
  contextProfileId = defaultContextProfile.id,
): Assistant => ({
  id: createId("assistant"),
  name: `新助手 ${index}`,
  description: "可在右侧细节面板编辑。",
  kind: "chat",
  modelBindings: baseModel
    ? [createBinding(baseModel.apiProfile, baseModel.model, true)]
    : [],
  contextProfileId,
  prompt: "",
  initialMessage: "",
  enabled: true,
});

const createEmptyContextProfile = (index: number): ContextProfile => ({
  id: createId("context-profile"),
  name: `上下文配置 ${index}`,
  description: "",
  dimensionOverrides: [],
});

const CustomSelect = ({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className = "",
}: {
  label: string;
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) => {
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selectValue = (nextValue: string) => {
    const option = options.find((candidate) => candidate.value === nextValue);
    if (!option || option.disabled) {
      return;
    }

    onChange(nextValue);
    setOpen(false);
  };

  const toggleOpen = () => {
    if (!disabled && options.length > 0) {
      setOpen((isOpen) => !isOpen);
    }
  };

  return (
    <div
      className={`custom-select ${open ? "open" : ""} ${
        disabled ? "disabled" : ""
      } ${className}`}
      ref={rootRef}
    >
      <button
        className="custom-select-trigger"
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        disabled={disabled || options.length === 0}
        onClick={toggleOpen}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowDown" ||
            event.key === "Enter" ||
            event.key === " "
          ) {
            event.preventDefault();
            toggleOpen();
          }
        }}
      >
        <span>{selectedOption?.label ?? "未选择"}</span>
        <span className="custom-select-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="custom-select-menu" id={listboxId} role="listbox">
          {options.map((option) => (
            <button
              className="custom-select-option"
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              onClick={() => selectValue(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const ReorderControls = ({
  itemName,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
}: {
  itemName: string;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) => (
  <div className="reorder-actions" aria-label={`调整 ${itemName} 顺序`}>
    <button
      className="reorder-button"
      type="button"
      aria-label={`上移 ${itemName}`}
      disabled={isFirst}
      onClick={onMoveUp}
    >
      ↑
    </button>
    <button
      className="reorder-button"
      type="button"
      aria-label={`下移 ${itemName}`}
      disabled={isLast}
      onClick={onMoveDown}
    >
      ↓
    </button>
  </div>
);

function moveListItemById<T extends { id: string }>(
  items: T[],
  itemId: string,
  direction: -1 | 1,
) {
  const fromIndex = items.findIndex((item) => item.id === itemId);
  const toIndex = fromIndex + direction;

  if (fromIndex < 0 || toIndex < 0 || toIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [item] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, item);
  return nextItems;
}

const confirmDestructiveAction = (message: string) =>
  typeof window === "undefined" || window.confirm(message);

const themeLabels: Record<ThemeMode, string> = {
  system: "跟随系统",
  light: "亮色",
  dark: "暗色",
};

const layoutLabels: Record<LayoutMode, string> = {
  auto: "跟随屏幕",
  mobile: "手机端",
  desktop: "电脑端",
};

const composerSubmitModeLabels: Record<ComposerSubmitMode, string> = {
  "enter-send": "Enter 发送，Shift+Enter 换行",
  "ctrl-enter-send": "Enter 换行，Ctrl+Enter 发送",
};

const normalizeContextSummaryRawTailMessages = (value: number) =>
  Number.isFinite(value)
    ? Math.max(0, Math.min(50, Math.trunc(value)))
    : DEFAULT_CONTEXT_SUMMARY_RAW_TAIL_MESSAGES;

const normalizeContextSummaryAutoMessageInterval = (value: number) =>
  Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.trunc(value)))
    : DEFAULT_CONTEXT_SUMMARY_AUTO_MESSAGE_INTERVAL;

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

const normalizeDefaultBinding = (
  bindings: AssistantModelBinding[],
): AssistantModelBinding[] => {
  const hasDefault = bindings.some((binding) => binding.isDefault);
  return bindings.map((binding, index) => ({
    ...binding,
    isDefault: hasDefault ? binding.isDefault : index === 0,
  }));
};

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

const resolveAssistantDefaultModel = (
  assistant: Assistant,
  apiProfiles: ApiProfile[],
): ResolvedModel | undefined => {
  const defaultBinding = assistant.modelBindings.find(
    (binding) => binding.enabled && binding.isDefault,
  );
  const defaultModel = defaultBinding
    ? resolveModel(apiProfiles, defaultBinding)
    : undefined;

  if (defaultModel?.apiProfile.enabled && defaultModel.model.enabled) {
    return defaultModel;
  }

  return listAssistantModels(assistant, apiProfiles)[0];
};

const getUtilityAssistantModelStrategy = (assistant: Assistant) =>
  assistant.kind === "utility"
    ? (assistant.utilityModelStrategy ?? "follow-conversation")
    : "fixed";

const resolveUtilityAssistantModel = (
  assistant: Assistant,
  activeModel: ResolvedModel | undefined,
  apiProfiles: ApiProfile[],
) => {
  if (getUtilityAssistantModelStrategy(assistant) === "fixed") {
    return resolveAssistantDefaultModel(assistant, apiProfiles);
  }

  return activeModel;
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

  const cached =
    typeof usage.cachedInputTokens === "number"
      ? usage.cachedInputTokens
      : "未返回";

  return `cache ${cached}/${usage.inputTokens}`;
};

const formatMessageTime = (iso?: string) => {
  if (!iso) {
    return "";
  }

  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) {
    return "";
  }

  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

const formatTranscriptMessage = (message: Message, index: number) => {
  const roleLabel = message.role === "user" ? "用户" : "助手";
  const time = formatMessageTime(message.createdAt);
  const source =
    message.role === "assistant" && message.source
      ? ` · ${message.source.assistantName} / ${message.source.modelName}`
      : "";

  return `#${index + 1} ${roleLabel}${source}${time ? ` · ${time}` : ""}\n${
    message.text.trim() || "[空消息]"
  }`;
};

const formatInspectorJson = (value: unknown) => JSON.stringify(value, null, 2);

const formatContextSummaryFramework = (framework: ContextSummaryFramework) =>
  framework.sections
    .map(
      (section) =>
        `## ${section.title}\n- sectionId: ${section.id}\n- required: ${
          section.required ? "yes" : "no"
        }\n- instruction: ${section.instruction}`,
    )
    .join("\n\n");

const resolveContextProfile = (
  profiles: ContextProfile[],
  profileId?: string,
): ContextProfile =>
  profiles.find((profile) => profile.id === profileId) ??
  profiles[0] ??
  defaultContextProfile;

const getContextProfileOverride = (
  profile: ContextProfile,
  dimensionId: string,
): ContextProfileDimensionOverride | undefined =>
  profile.dimensionOverrides.find(
    (override) => override.dimensionId === dimensionId,
  );

const isContextProfileDimensionEnabled = (
  profile: ContextProfile,
  dimensionId: string,
) => getContextProfileOverride(profile, dimensionId)?.enabled !== false;

const getEnabledContextProfileSections = (
  framework: ContextSummaryFramework,
  profile: ContextProfile,
) =>
  framework.sections.filter((section) =>
    isContextProfileDimensionEnabled(profile, section.id),
  );

const formatContextProfile = (
  framework: ContextSummaryFramework,
  profile: ContextProfile,
) =>
  getEnabledContextProfileSections(framework, profile)
    .map((section) => {
      const override = getContextProfileOverride(profile, section.id);
      const title = override?.titleOverride?.trim() || section.title;
      const instruction = override?.instruction.trim();

      return [
        `## ${title}`,
        `- dimensionId: ${section.id}`,
        `- base: ${section.instruction}`,
        `- profile: ${instruction || "无额外重载，按基础维度理解。"}`,
      ].join("\n");
    })
    .join("\n\n");

const buildContextProfileInstruction = (
  framework: ContextSummaryFramework,
  profile: ContextProfile,
) => {
  const formattedProfile = formatContextProfile(framework, profile);
  if (!formattedProfile.trim()) {
    return "";
  }

  return `MobileChat 当前聊天助手绑定的上下文配置：
名称：${profile.name}
说明：${profile.description || "无"}

这些设定用于理解当前对话中应优先保留和遵守的上下文，不是用户的新消息。请按各维度理解长期规则、事实、模糊状态、探索记录和当前现场：

${formattedProfile}`;
};

const createEffectiveContextSummarySections = (
  framework: ContextSummaryFramework,
  profile: ContextProfile,
) =>
  getEnabledContextProfileSections(framework, profile).map((section) => {
    const override = getContextProfileOverride(profile, section.id);
    const overrideInstruction = override?.instruction.trim();
    return {
      ...section,
      title: override?.titleOverride?.trim() || section.title,
      instruction: overrideInstruction
        ? `${section.instruction}\n\n上下文配置重载：${overrideInstruction}`
        : section.instruction,
    };
  });

const buildContextSummaryPrompt = ({
  conversation,
  previousSummary,
  messages,
  framework,
  contextProfile,
}: {
  conversation: Conversation;
  previousSummary?: string;
  messages: Message[];
  framework: ContextSummaryFramework;
  contextProfile: ContextProfile;
}) => {
  const effectiveSections = createEffectiveContextSummarySections(
    framework,
    contextProfile,
  );
  const effectiveFramework: ContextSummaryFramework = {
    ...framework,
    sections: effectiveSections,
  };
  const formattedProfile = formatContextProfile(framework, contextProfile);

  return `请为 MobileChat 当前单个对话生成新的“上下文总结”。

要求：
- 只总结对后续继续对话有用的信息，不要生成普通聊天回复。
- 保留用户目标、明确决策、技术约束、已完成修改、待验证问题、重要路径/配置/错误信息。
- 不要臆测，不要补充消息中没有的事实。
- 对话标题和列表摘要只作为定位参考，不要把它们写进总结正文；除非用户明确把标题或摘要本身当作业务事实讨论。
- 如果已有旧总结，请把新增消息合并进去，输出一份完整的新总结。
- 必须使用下面的总结框架作为 Markdown 二级标题；没有内容的可写“无”。
- 输出中文 Markdown，尽量紧凑，优先结构化。

总结框架：${framework.name}
${framework.description}

${formatContextSummaryFramework(effectiveFramework)}

当前聊天助手的上下文配置：${contextProfile.name}
${contextProfile.description || "无说明"}

配置维度重载：
${formattedProfile || "当前上下文配置未启用任何上下文维度。"}

定位信息（仅供理解，不要写入总结正文）：
- 对话标题：${conversation.title}
- 列表摘要：${conversation.summary || "无"}

旧上下文总结：
${previousSummary?.trim() || "无"}

需要合并的新增消息：
${messages.map(formatTranscriptMessage).join("\n\n")}
`;
};

const getActiveContextSummaryRecord = (
  conversation?: Conversation,
): ContextSummaryRecord | undefined => {
  if (!conversation) {
    return undefined;
  }

  const records = conversation.contextSummaries ?? [];
  const activeRecord =
    records.find(
      (record) => record.id === conversation.activeContextSummaryId,
    ) ??
    records.find((record) => record.status === "active") ??
    records[0];

  if (activeRecord) {
    return activeRecord;
  }

  return undefined;
};

const createContextSummaryProjectionMessage = (
  conversation: Conversation,
): Message | undefined => {
  const activeSummary = getActiveContextSummaryRecord(conversation);
  const contextSummary = activeSummary?.text.trim();
  if (!contextSummary) {
    return undefined;
  }

  return {
    id: `context-summary-${conversation.id}`,
    conversationId: conversation.id,
    role: "user",
    label: "上下文总结",
    text: `以下是 MobileChat 本地生成的历史上下文总结，仅用于延续当前对话，不是用户的新指令：\n\n${contextSummary}`,
    createdAt: activeSummary?.updatedAt ?? "1970-01-01T00:00:00.000Z",
    status: "complete",
  };
};

const projectMessagesForRequest = (
  conversation: Conversation,
  messages: Message[],
): Message[] => {
  const summaryMessage = createContextSummaryProjectionMessage(conversation);
  const boundaryMessageId =
    getActiveContextSummaryRecord(conversation)?.boundaryMessageId;

  if (!summaryMessage || !boundaryMessageId) {
    return messages;
  }

  const boundaryIndex = messages.findIndex(
    (message) => message.id === boundaryMessageId,
  );

  if (boundaryIndex < 0) {
    return messages;
  }

  return [summaryMessage, ...messages.slice(boundaryIndex + 1)];
};

const clearConversationContextSummary = (
  conversation: Conversation,
): Conversation => {
  const {
    contextSummaries: _contextSummaries,
    activeContextSummaryId: _activeContextSummaryId,
    ...rest
  } = conversation;

  return rest;
};

const formatElapsedMs = (elapsedMs?: number) => {
  if (
    typeof elapsedMs !== "number" ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0
  ) {
    return "";
  }

  if (elapsedMs < 1000) {
    return `${Math.round(elapsedMs)}ms`;
  }

  if (elapsedMs < 60_000) {
    const seconds = elapsedMs / 1000;
    return `${seconds < 10 ? seconds.toFixed(1) : seconds.toFixed(0)}s`;
  }

  const minutes = Math.floor(elapsedMs / 60_000);
  const seconds = Math.round((elapsedMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
};

const createCompletionTiming = (startedAt: number) => {
  const completedMs = Date.now();
  const safeStartedAt = Number.isFinite(startedAt) ? startedAt : completedMs;
  return {
    completedAt: new Date(completedMs).toISOString(),
    elapsedMs: Math.max(0, completedMs - safeStartedAt),
  };
};

const createCompletionTimingFromMessage = (message: Message) => {
  const parsedStartedAt = Date.parse(message.createdAt);
  return createCompletionTiming(
    Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now(),
  );
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

const compareMessagesByCreatedAt = (left: Message, right: Message) => {
  const parsedLeftTime = Date.parse(left.createdAt);
  const parsedRightTime = Date.parse(right.createdAt);
  const leftTime = Number.isFinite(parsedLeftTime) ? parsedLeftTime : 0;
  const rightTime = Number.isFinite(parsedRightTime) ? parsedRightTime : 0;

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  if (left.role !== right.role) {
    return left.role === "user" ? -1 : 1;
  }
  return left.id.localeCompare(right.id);
};

const createTurnTimestamps = () => {
  const now = Date.now();
  return {
    userCreatedAt: new Date(now).toISOString(),
    assistantCreatedAt: new Date(now + 1).toISOString(),
  };
};

function App() {
  const bootSnapshot = useMemo(() => createBootSnapshot(), []);
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
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(
    bootSnapshot.settings.layoutMode,
  );
  const [viewportIsMobile, setViewportIsMobile] = useState(getViewportIsMobile);
  const [streamingEnabled, setStreamingEnabled] = useState(
    bootSnapshot.settings.streamingEnabled,
  );
  const [composerSubmitMode, setComposerSubmitMode] =
    useState<ComposerSubmitMode>(bootSnapshot.settings.composerSubmitMode);
  const [contextSummaryRawTailMessages, setContextSummaryRawTailMessages] =
    useState(bootSnapshot.settings.contextSummaryRawTailMessages);
  const [
    contextSummaryAutoMessageInterval,
    setContextSummaryAutoMessageInterval,
  ] = useState(bootSnapshot.settings.contextSummaryAutoMessageInterval);
  const [utilityAssistantRefs, setUtilityAssistantRefs] = useState(
    bootSnapshot.settings.utilityAssistantRefs,
  );
  const [contextSummaryFramework, setContextSummaryFramework] = useState(
    bootSnapshot.settings.contextSummaryFramework,
  );
  const [contextProfiles, setContextProfiles] = useState<ContextProfile[]>(
    bootSnapshot.settings.contextProfiles,
  );
  const [editingContextProfileId, setEditingContextProfileId] = useState(
    bootSnapshot.settings.editingContextProfileId,
  );
  const [nextTurnWebSearchEnabled, setNextTurnWebSearchEnabled] =
    useState(false);
  const [nextTurnMultimodalEnabled, setNextTurnMultimodalEnabled] =
    useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataInspectorOpen, setDataInspectorOpen] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(
    bootSnapshot.settings.debugEnabled,
  );
  const [draft, setDraft] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [scrollShortcutTarget, setScrollShortcutTarget] = useState<
    "top" | "bottom"
  >("top");
  const [conversationSearch, setConversationSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
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
  const [contextSummaryPending, setContextSummaryPending] = useState(false);
  const [contextSummaryStatus, setContextSummaryStatus] = useState("");
  const [contextSummaryPreviewOpen, setContextSummaryPreviewOpen] =
    useState(false);
  const [mobileDiagnosticsExpanded, setMobileDiagnosticsExpanded] =
    useState(false);
  const [pwaNotice, setPwaNotice] = useState<PwaNotice>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const latestSnapshotRef = useRef<LocalDataSnapshot>(bootSnapshot);
  const contextSummaryJobRunningRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const messageThreadRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const drawerSwipeRef = useRef<{
    mode: "open-panel" | "close-drawer" | "close-settings";
    startX: number;
    startY: number;
  } | null>(null);

  const resizeComposerInput = useCallback(() => {
    const input = composerInputRef.current;
    if (!input) {
      return;
    }

    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
    input.style.overflowY =
      input.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resizeComposerInput();
  }, [draft, resizeComposerInput]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 820px)");
    const updateViewportMode = () => {
      setViewportIsMobile(mediaQuery.matches);
    };

    updateViewportMode();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateViewportMode);
    } else {
      mediaQuery.addListener(updateViewportMode);
    }

    return () => {
      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", updateViewportMode);
      } else {
        mediaQuery.removeListener(updateViewportMode);
      }
    };
  }, []);

  useEffect(() => {
    if (!debugEnabled) {
      setDataInspectorOpen(false);
      setMobileDiagnosticsExpanded(false);
    }
  }, [debugEnabled]);

  const updateScrollShortcutTarget = useCallback(() => {
    const thread = messageThreadRef.current;
    const threadMaxScrollTop = thread
      ? thread.scrollHeight - thread.clientHeight
      : 0;
    const threadScrollable = threadMaxScrollTop > SCROLL_EDGE_THRESHOLD_PX;

    if (threadScrollable && thread) {
      if (thread.scrollTop <= SCROLL_EDGE_THRESHOLD_PX) {
        setScrollShortcutTarget("bottom");
        return;
      }
      if (thread.scrollTop >= threadMaxScrollTop - SCROLL_EDGE_THRESHOLD_PX) {
        setScrollShortcutTarget("top");
        return;
      }
    }

    const scrollElement = document.scrollingElement ?? document.documentElement;
    const pageMaxScrollTop = scrollElement.scrollHeight - window.innerHeight;
    const pageScrollable = pageMaxScrollTop > SCROLL_EDGE_THRESHOLD_PX;

    if (pageScrollable) {
      if (window.scrollY <= SCROLL_EDGE_THRESHOLD_PX) {
        setScrollShortcutTarget("bottom");
        return;
      }
      if (window.scrollY >= pageMaxScrollTop - SCROLL_EDGE_THRESHOLD_PX) {
        setScrollShortcutTarget("top");
      }
    }
  }, []);

  const activeAssistant = useMemo(
    () =>
      assistants.find(
        (assistant) =>
          assistant.id === activeAssistantId && assistant.kind === "chat",
      ) ??
      assistants.find(
        (assistant) => assistant.kind === "chat" && assistant.enabled,
      ) ??
      assistants.find((assistant) => assistant.kind === "chat") ??
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
  const activeContextProfile = useMemo(
    () =>
      resolveContextProfile(contextProfiles, activeAssistant.contextProfileId),
    [activeAssistant.contextProfileId, contextProfiles],
  );
  const editingContextProfile = useMemo(
    () => resolveContextProfile(contextProfiles, editingContextProfileId),
    [contextProfiles, editingContextProfileId],
  );
  const activeContextInstruction = useMemo(
    () =>
      buildContextProfileInstruction(
        contextSummaryFramework,
        activeContextProfile,
      ),
    [activeContextProfile, contextSummaryFramework],
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
      sortMessagesByCreatedAt(
        messages.filter(
          (message) => message.conversationId === activeConversation?.id,
        ),
      ),
    [activeConversation?.id, messages],
  );
  const activeProjectedMessages = useMemo(
    () =>
      activeConversation
        ? projectMessagesForRequest(activeConversation, activeMessages)
        : activeMessages,
    [activeConversation, activeMessages],
  );
  const activeResolvedModel = useMemo(
    () => resolveModel(apiProfiles, activeModelRef),
    [activeModelRef, apiProfiles],
  );
  const contextSummaryAssistant = useMemo(
    () =>
      assistants.find(
        (assistant) =>
          assistant.id === utilityAssistantRefs.contextSummaryAssistantId &&
          assistant.kind === "utility" &&
          assistant.enabled,
      ) ??
      assistants.find(
        (assistant) =>
          assistant.id === CONTEXT_SUMMARY_ASSISTANT_ID && assistant.enabled,
      ) ??
      assistants.find(
        (assistant) => assistant.kind === "utility" && assistant.enabled,
      ),
    [assistants, utilityAssistantRefs.contextSummaryAssistantId],
  );
  const contextSummaryResolvedModel = useMemo(
    () =>
      contextSummaryAssistant
        ? resolveUtilityAssistantModel(
            contextSummaryAssistant,
            activeResolvedModel,
            apiProfiles,
          )
        : undefined,
    [activeResolvedModel, apiProfiles, contextSummaryAssistant],
  );
  const assistantModelOptions = useMemo(
    () => listAssistantModels(activeAssistant, apiProfiles),
    [activeAssistant, apiProfiles],
  );
  const allModelOptions = useMemo(
    () => listAllModels(apiProfiles),
    [apiProfiles],
  );
  const editingAssistantModelStrategy =
    getUtilityAssistantModelStrategy(editingAssistant);
  const editingAssistantResolvedModelOptions = useMemo(
    () => listAssistantModels(editingAssistant, apiProfiles),
    [apiProfiles, editingAssistant],
  );
  const editingAssistantDefaultResolvedModel = useMemo(
    () => resolveAssistantDefaultModel(editingAssistant, apiProfiles),
    [apiProfiles, editingAssistant],
  );
  const activeConversations = useMemo(
    () => conversations.filter((conversation) => !conversation.archived),
    [conversations],
  );
  const archivedConversations = useMemo(
    () => conversations.filter((conversation) => conversation.archived),
    [conversations],
  );
  const visibleConversations = useMemo(() => {
    const keyword = conversationSearch.trim().toLocaleLowerCase();
    const source = showArchived ? archivedConversations : activeConversations;

    return source.filter((conversation) => {
      if (!keyword) {
        return true;
      }

      return `${conversation.title} ${conversation.summary}`
        .toLocaleLowerCase()
        .includes(keyword);
    });
  }, [
    activeConversations,
    archivedConversations,
    conversationSearch,
    showArchived,
  ]);
  const activeConversationReadOnly =
    showArchived || Boolean(activeConversation?.archived);
  const activeContextSummary = useMemo(
    () => getActiveContextSummaryRecord(activeConversation),
    [activeConversation],
  );
  const activeContextSummaryBoundaryIndex = useMemo(() => {
    if (!activeContextSummary?.boundaryMessageId) {
      return -1;
    }

    return activeMessages.findIndex(
      (message) => message.id === activeContextSummary.boundaryMessageId,
    );
  }, [activeContextSummary, activeMessages]);
  const activeContextSummaryCoveredMessages = useMemo(
    () =>
      activeContextSummaryBoundaryIndex >= 0
        ? activeMessages.slice(0, activeContextSummaryBoundaryIndex + 1)
        : [],
    [activeContextSummaryBoundaryIndex, activeMessages],
  );
  const activeContextSummaryRetainedMessages = useMemo(() => {
    if (!activeContextSummary) {
      return activeMessages;
    }

    return activeContextSummaryBoundaryIndex >= 0
      ? activeMessages.slice(activeContextSummaryBoundaryIndex + 1)
      : activeMessages;
  }, [activeContextSummary, activeContextSummaryBoundaryIndex, activeMessages]);
  const dataInspectorOverview = useMemo(
    () => ({
      conversations: conversations.length,
      activeConversations: activeConversations.length,
      archivedConversations: archivedConversations.length,
      messages: messages.length,
      connections: apiProfiles.length,
      models: apiProfiles.reduce(
        (total, profile) => total + profile.models.length,
        0,
      ),
      chatAssistants: assistants.filter(
        (assistant) => assistant.kind === "chat",
      ).length,
      utilityAssistants: assistants.filter(
        (assistant) => assistant.kind === "utility",
      ).length,
      contextProfiles: contextProfiles.length,
      contextSummaryRecords: conversations.reduce(
        (total, conversation) =>
          total + (conversation.contextSummaries?.length ?? 0),
        0,
      ),
      rawTailMessages: contextSummaryRawTailMessages,
      autoSummaryInterval: contextSummaryAutoMessageInterval,
    }),
    [
      activeConversations.length,
      apiProfiles,
      archivedConversations.length,
      assistants,
      contextProfiles.length,
      contextSummaryAutoMessageInterval,
      contextSummaryRawTailMessages,
      conversations,
      messages.length,
    ],
  );
  const dataInspectorConversation = useMemo(
    () =>
      activeConversation
        ? {
            id: activeConversation.id,
            title: activeConversation.title,
            summary: activeConversation.summary,
            archived: Boolean(activeConversation.archived),
            messageCount: activeMessages.length,
            activeContextSummaryId:
              activeConversation.activeContextSummaryId ?? null,
            contextSummaryCount:
              activeConversation.contextSummaries?.length ?? 0,
          }
        : null,
    [activeConversation, activeMessages.length],
  );
  const dataInspectorSummaryDiff = useMemo(
    () => ({
      hasActiveSummary: Boolean(activeContextSummary?.text.trim()),
      summaryId: activeContextSummary?.id ?? null,
      boundaryMessageId: activeContextSummary?.boundaryMessageId ?? null,
      boundaryFound: activeContextSummaryBoundaryIndex >= 0,
      boundaryIndex: activeContextSummaryBoundaryIndex,
      coveredMessagesInRecord:
        activeContextSummary?.coveredMessageCount ?? null,
      coveredMessagesResolved: activeContextSummaryCoveredMessages.length,
      retainedRawMessagesInRecord:
        activeContextSummary?.retainedRawMessageCount ?? null,
      retainedRawMessagesResolved: activeContextSummaryRetainedMessages.length,
      projectedRequestMessages: activeProjectedMessages.length,
      source: activeContextSummary?.source ?? null,
      framework: activeContextSummary
        ? {
            id: activeContextSummary.frameworkId,
            name: activeContextSummary.frameworkNameSnapshot,
            schemaVersion: activeContextSummary.schemaVersion,
          }
        : null,
      contextProfile: activeContextSummary
        ? {
            id: activeContextSummary.contextProfileId ?? null,
            name: activeContextSummary.contextProfileNameSnapshot ?? null,
          }
        : null,
    }),
    [
      activeContextSummary,
      activeContextSummaryBoundaryIndex,
      activeContextSummaryCoveredMessages.length,
      activeContextSummaryRetainedMessages.length,
      activeProjectedMessages.length,
    ],
  );

  const chatAssistants = useMemo(
    () => assistants.filter((assistant) => assistant.kind === "chat"),
    [assistants],
  );
  const utilityAssistants = useMemo(
    () => assistants.filter((assistant) => assistant.kind === "utility"),
    [assistants],
  );
  const chatAssistantCount = chatAssistants.length;
  const utilityAssistantCount = utilityAssistants.length;
  const diagnostics = useMemo(
    () => [
      [
        "输入估算",
        `${estimateTokenCount(
          activeProjectedMessages,
          activeContextInstruction
            ? `${activeContextInstruction}\n${draft}`
            : draft,
        )} tokens`,
      ],
      [
        "可缓存前缀估算",
        activeProjectedMessages.length > 2
          ? "high"
          : activeProjectedMessages.length > 0
            ? "low"
            : "0%",
      ],
      [
        "发送前预算",
        `${activeResolvedModel?.model.name ?? "未选择模型"} · ${
          nextTurnWebSearchEnabled ? "联网" : "不联网"
        } · ${nextTurnMultimodalEnabled ? "多模态预留" : "仅文本"}`,
      ],
      ["发送后 usage", formatObservedUsage(lastObservedUsage)],
    ],
    [
      activeProjectedMessages,
      activeContextInstruction,
      activeResolvedModel?.model.name,
      draft,
      lastObservedUsage,
      nextTurnMultimodalEnabled,
      nextTurnWebSearchEnabled,
    ],
  );
  const isCompactLayout =
    layoutMode === "mobile" || (layoutMode === "auto" && viewportIsMobile);
  const diagnosticsPanelExpanded =
    !isCompactLayout || mobileDiagnosticsExpanded;
  const diagnosticsBrief = `${diagnostics[0]?.[1] ?? "无估算"} · ${
    diagnostics[2]?.[1] ?? "未选择模型"
  }`;
  const handleDrawerSwipeStart = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      if (!isCompactLayout || dataInspectorOpen) {
        drawerSwipeRef.current = null;
        return;
      }

      const touch = event.touches[0];
      if (!touch) {
        drawerSwipeRef.current = null;
        return;
      }

      const targetElement = getElementTarget(event.target);

      if (settingsOpen) {
        if (targetElement?.closest(PANEL_SWIPE_IGNORE_SELECTOR)) {
          drawerSwipeRef.current = null;
          return;
        }

        drawerSwipeRef.current = {
          mode: "close-settings",
          startX: touch.clientX,
          startY: touch.clientY,
        };
        return;
      }

      if (drawerOpen) {
        if (targetElement?.closest("input, textarea, select, .custom-select")) {
          drawerSwipeRef.current = null;
          return;
        }

        drawerSwipeRef.current = {
          mode: "close-drawer",
          startX: touch.clientX,
          startY: touch.clientY,
        };
        return;
      }

      if (
        isNearHorizontalViewportEdge(touch.clientX) ||
        !targetElement?.closest(".chat-surface") ||
        targetElement.closest(PANEL_SWIPE_IGNORE_SELECTOR)
      ) {
        drawerSwipeRef.current = null;
        return;
      }

      drawerSwipeRef.current = {
        mode: "open-panel",
        startX: touch.clientX,
        startY: touch.clientY,
      };
    },
    [dataInspectorOpen, drawerOpen, isCompactLayout, settingsOpen],
  );
  const handleDrawerSwipeEnd = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      const swipe = drawerSwipeRef.current;
      drawerSwipeRef.current = null;

      if (!swipe) {
        return;
      }

      const touch = event.changedTouches[0];
      if (!touch) {
        return;
      }

      const deltaX = touch.clientX - swipe.startX;
      const deltaY = touch.clientY - swipe.startY;
      if (Math.abs(deltaY) > PANEL_SWIPE_VERTICAL_LIMIT_PX) {
        return;
      }

      if (swipe.mode === "open-panel" && deltaX >= PANEL_SWIPE_TRIGGER_PX) {
        setDrawerOpen(true);
      }
      if (swipe.mode === "open-panel" && deltaX <= -PANEL_SWIPE_TRIGGER_PX) {
        setEditingAssistantId(activeAssistant.id);
        setDrawerOpen(false);
        setSettingsOpen(true);
      }
      if (swipe.mode === "close-drawer" && deltaX <= -PANEL_SWIPE_TRIGGER_PX) {
        setDrawerOpen(false);
      }
      if (swipe.mode === "close-settings" && deltaX >= PANEL_SWIPE_TRIGGER_PX) {
        setSettingsOpen(false);
      }
    },
    [activeAssistant.id],
  );
  const cancelDrawerSwipe = useCallback(() => {
    drawerSwipeRef.current = null;
  }, []);
  const appSettings = useMemo(
    () => ({
      ...bootSnapshot.settings,
      activeConversationId,
      activeAssistantId,
      activeModelRef,
      editingAssistantId,
      themeMode,
      layoutMode,
      streamingEnabled,
      composerSubmitMode,
      contextSummaryRawTailMessages,
      contextSummaryAutoMessageInterval,
      debugEnabled,
      apiProfileOrder: apiProfiles.map((profile) => profile.id),
      assistantOrder: assistants.map((assistant) => assistant.id),
      utilityAssistantRefs,
      contextSummaryFramework,
      contextProfiles,
      editingContextProfileId,
      lastSuccessfulExportAt,
      storagePersisted: storageInfo.persisted,
      storageUsage: storageInfo.usage,
      storageQuota: storageInfo.quota,
    }),
    [
      activeAssistantId,
      activeConversationId,
      activeModelRef,
      apiProfiles,
      assistants,
      composerSubmitMode,
      contextSummaryAutoMessageInterval,
      contextSummaryRawTailMessages,
      contextSummaryFramework,
      contextProfiles,
      debugEnabled,
      editingAssistantId,
      editingContextProfileId,
      layoutMode,
      lastSuccessfulExportAt,
      streamingEnabled,
      storageInfo.persisted,
      storageInfo.quota,
      storageInfo.usage,
      themeMode,
      utilityAssistantRefs,
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
    setLayoutMode(snapshot.settings.layoutMode);
    setStreamingEnabled(snapshot.settings.streamingEnabled);
    setComposerSubmitMode(snapshot.settings.composerSubmitMode);
    setContextSummaryRawTailMessages(
      snapshot.settings.contextSummaryRawTailMessages,
    );
    setContextSummaryAutoMessageInterval(
      snapshot.settings.contextSummaryAutoMessageInterval,
    );
    setDebugEnabled(snapshot.settings.debugEnabled);
    setUtilityAssistantRefs(snapshot.settings.utilityAssistantRefs);
    setContextSummaryFramework(snapshot.settings.contextSummaryFramework);
    setContextProfiles(snapshot.settings.contextProfiles);
    setEditingContextProfileId(snapshot.settings.editingContextProfileId);
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
    try {
      window.localStorage.setItem(
        UI_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ themeMode, layoutMode }),
      );
    } catch {
      // Ignore private-mode or quota errors; IndexedDB remains authoritative.
    }

    if (themeMode === "system") {
      root.removeAttribute("data-theme");
      root.style.colorScheme = "light dark";
      return;
    }

    root.dataset.theme = themeMode;
    root.style.colorScheme = themeMode;
  }, [layoutMode, themeMode]);

  useEffect(() => {
    updateScrollShortcutTarget();
    window.addEventListener("scroll", updateScrollShortcutTarget, {
      passive: true,
    });
    window.addEventListener("resize", updateScrollShortcutTarget);
    return () => {
      window.removeEventListener("scroll", updateScrollShortcutTarget);
      window.removeEventListener("resize", updateScrollShortcutTarget);
    };
  }, [activeMessages.length, updateScrollShortcutTarget]);

  useEffect(() => {
    setContextSummaryPreviewOpen(false);
    setContextSummaryStatus("");
  }, [activeConversation?.id]);

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
    if (activeAssistant.id !== activeAssistantId) {
      setActiveAssistantId(activeAssistant.id);
      return;
    }

    const selectedRef = chooseModelForAssistant(
      activeAssistant,
      activeModelRef,
      apiProfiles,
    );
    if (modelRefKey(selectedRef) !== modelRefKey(activeModelRef)) {
      setActiveModelRef(selectedRef);
    }
  }, [activeAssistant, activeAssistantId, activeModelRef, apiProfiles]);

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
                ...createCompletionTimingFromMessage(message),
                text:
                  message.text &&
                  message.text !== "正在请求模型…" &&
                  message.text !== "正在等待流式输出…"
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
      assistants.find(
        (assistant) =>
          assistant.id === assistantId && assistant.kind === "chat",
      ) ?? activeAssistant;
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
    setShowArchived(false);
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

  const openArchivedConversations = () => {
    setShowArchived(true);
    setConversationSearch("");
    const firstArchived = archivedConversations[0];
    if (firstArchived) {
      setActiveConversationId(firstArchived.id);
    }
  };

  const openActiveConversations = () => {
    setShowArchived(false);
    setConversationSearch("");
    if (!activeConversation || activeConversation.archived) {
      const firstActive = activeConversations[0];
      if (firstActive) {
        setActiveConversationId(firstActive.id);
      }
    }
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
    if (!activeConversation || activeConversation.archived) {
      return;
    }

    const nextActive = activeConversations.find(
      (conversation) => conversation.id !== activeConversation.id,
    );

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, archived: true }
          : conversation,
      ),
    );
    setShowArchived(false);

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

  const restoreActiveConversation = () => {
    if (!activeConversation || !activeConversation.archived) {
      return;
    }

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, archived: false }
          : conversation,
      ),
    );
    setShowArchived(false);
    setConversationSearch("");
    setActiveConversationId(activeConversation.id);
  };

  const deleteActiveConversation = () => {
    if (!activeConversation) {
      return;
    }

    if (
      !confirmDestructiveAction(
        `永久删除对话「${activeConversation.title}」及其消息？`,
      )
    ) {
      return;
    }

    const deletedConversation = activeConversation;
    stopResponse("已停止当前对话的未完成回复。");

    const remainingConversations = conversations.filter(
      (conversation) => conversation.id !== deletedConversation.id,
    );
    const remainingActive = remainingConversations.filter(
      (conversation) => !conversation.archived,
    );
    const remainingArchived = remainingConversations.filter(
      (conversation) => conversation.archived,
    );
    const fallbackConversation =
      remainingActive.length === 0
        ? {
            id: createId("conversation"),
            title: "新对话",
            summary: "删除后创建的空对话",
            archived: false,
          }
        : undefined;
    const nextConversations = fallbackConversation
      ? [fallbackConversation, ...remainingConversations]
      : remainingConversations;
    const nextConversation =
      deletedConversation.archived && remainingArchived.length > 0
        ? remainingArchived[0]
        : (fallbackConversation ?? remainingActive[0] ?? nextConversations[0]);

    setConversations(nextConversations);
    setMessages((current) =>
      current.filter(
        (message) => message.conversationId !== deletedConversation.id,
      ),
    );
    setActiveConversationId(nextConversation?.id ?? "");
    setShowArchived(
      deletedConversation.archived && remainingArchived.length > 0,
    );
    setConversationSearch("");
    setDrawerOpen(false);
    setDraft("");
    setEditingTitleConversationId(null);
    setTitleDraft("");
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
    const newAssistant = createEmptyAssistant(
      assistants.length + 1,
      baseModel,
      activeContextProfile.id,
    );

    setAssistants((current) => [...current, newAssistant]);
    setActiveAssistantId(newAssistant.id);
    setEditingAssistantId(newAssistant.id);
    if (baseModel) {
      setActiveModelRef(baseModel.ref);
    }
  };

  const moveAssistant = (assistantId: string, direction: -1 | 1) => {
    setAssistants((current) => {
      const targetAssistant = current.find(
        (assistant) => assistant.id === assistantId,
      );
      if (!targetAssistant) {
        return current;
      }

      const sameKindAssistants = current.filter(
        (assistant) => assistant.kind === targetAssistant.kind,
      );
      const reorderedSameKindAssistants = moveListItemById(
        sameKindAssistants,
        assistantId,
        direction,
      );
      let sameKindIndex = 0;

      return current.map((assistant) => {
        if (assistant.kind !== targetAssistant.kind) {
          return assistant;
        }

        return reorderedSameKindAssistants[sameKindIndex++] ?? assistant;
      });
    });
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

  const updateAssistantContextProfile = (
    assistantId: string,
    contextProfileId: string,
  ) => {
    setAssistants((current) =>
      current.map((assistant) =>
        assistant.id === assistantId
          ? { ...assistant, contextProfileId }
          : assistant,
      ),
    );
  };

  const updateUtilityAssistantModelStrategy = (
    assistantId: string,
    utilityModelStrategy: UtilityAssistantModelStrategy,
  ) => {
    const fallbackModel = activeResolvedModel ?? allModelOptions[0];

    setAssistants((current) =>
      current.map((assistant) => {
        if (assistant.id !== assistantId) {
          return assistant;
        }

        const hasOnlyDefaultPlaceholderBinding =
          assistant.modelBindings.length <= 1 &&
          assistant.modelBindings.every(
            (binding) =>
              modelRefKey(binding) === modelRefKey(DEFAULT_MODEL_REF),
          );
        const seededFixedBinding =
          utilityModelStrategy === "fixed" &&
          (assistant.modelBindings.length === 0 ||
            hasOnlyDefaultPlaceholderBinding) &&
          fallbackModel
            ? createBinding(fallbackModel.apiProfile, fallbackModel.model, true)
            : undefined;

        return {
          ...assistant,
          utilityModelStrategy,
          modelBindings: seededFixedBinding
            ? [seededFixedBinding]
            : assistant.modelBindings,
        };
      }),
    );
  };

  const deleteAssistant = (assistantId: string) => {
    const targetAssistant = assistants.find(
      (assistant) => assistant.id === assistantId,
    );
    if (!targetAssistant) {
      return;
    }

    if (
      !confirmDestructiveAction(
        `删除助手「${targetAssistant.name}」？历史消息会保留当时的助手快照。`,
      )
    ) {
      return;
    }

    const remainingAssistants = assistants.filter(
      (assistant) => assistant.id !== assistantId,
    );
    const fallbackAssistant =
      remainingAssistants.length === 0
        ? createEmptyAssistant(
            1,
            activeResolvedModel ?? allModelOptions[0],
            activeContextProfile.id,
          )
        : undefined;
    const nextAssistants = fallbackAssistant
      ? [fallbackAssistant]
      : remainingAssistants;
    const nextAssistant =
      nextAssistants.find((assistant) => assistant.id !== assistantId) ??
      nextAssistants[0];
    if (!nextAssistant) {
      return;
    }

    setAssistants(nextAssistants);
    setActiveAssistantId((current) =>
      current === assistantId ? nextAssistant.id : current,
    );
    setEditingAssistantId(nextAssistant.id);
    setActiveModelRef(
      chooseModelForAssistant(nextAssistant, activeModelRef, apiProfiles),
    );
  };

  const createApiProfile = () => {
    const newProfile = createEmptyApiProfile(apiProfiles.length + 1);

    setApiProfiles((current) => [...current, newProfile]);
    setEditingApiProfileId(newProfile.id);
    setEditingModelId(newProfile.models[0]?.id ?? "");
  };

  const moveApiProfile = (profileId: string, direction: -1 | 1) => {
    setApiProfiles((current) =>
      moveListItemById(current, profileId, direction),
    );
  };

  const updateApiProfileField = (
    profileId: string,
    key: keyof Pick<
      ApiProfile,
      "name" | "description" | "baseUrl" | "apiKey" | "protocol" | "enabled"
    >,
    value: string | boolean | ApiProtocol,
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

  const deleteApiProfile = (profileId: string) => {
    const targetProfile = apiProfiles.find(
      (profile) => profile.id === profileId,
    );
    if (!targetProfile) {
      return;
    }

    if (
      !confirmDestructiveAction(
        `删除连接「${targetProfile.name}」及其模型配置？相关助手绑定会同步移除。`,
      )
    ) {
      return;
    }

    const remainingProfiles = apiProfiles.filter(
      (profile) => profile.id !== profileId,
    );
    const fallbackProfile =
      remainingProfiles.length === 0 ? createEmptyApiProfile(1) : undefined;
    const nextProfiles = fallbackProfile
      ? [fallbackProfile]
      : remainingProfiles;
    const fallbackModel = listAllModels(nextProfiles)[0];

    setApiProfiles(nextProfiles);
    setAssistants((current) =>
      current.map((assistant) => {
        const filteredBindings = assistant.modelBindings.filter(
          (binding) => binding.apiProfileId !== profileId,
        );
        const nextBindings =
          filteredBindings.length > 0
            ? filteredBindings
            : fallbackModel
              ? [
                  createBinding(
                    fallbackModel.apiProfile,
                    fallbackModel.model,
                    true,
                  ),
                ]
              : [];

        return {
          ...assistant,
          modelBindings: normalizeDefaultBinding(nextBindings),
        };
      }),
    );
    setEditingApiProfileId(nextProfiles[0]?.id ?? "");
    setEditingModelId(nextProfiles[0]?.models[0]?.id ?? "");
    if (activeModelRef.apiProfileId === profileId) {
      setActiveModelRef(fallbackModel?.ref ?? DEFAULT_MODEL_REF);
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
                  description: "",
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

  const moveModel = (profileId: string, modelId: string, direction: -1 | 1) => {
    setApiProfiles((current) =>
      current.map((profile) =>
        profile.id === profileId
          ? {
              ...profile,
              models: moveListItemById(profile.models, modelId, direction),
            }
          : profile,
      ),
    );
  };

  const deleteModel = (profileId: string, modelId: string) => {
    const profile = apiProfiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      return;
    }

    const remainingModels = profile.models.filter(
      (model) => model.id !== modelId,
    );
    const nextModelRef =
      remainingModels[0] !== undefined
        ? { apiProfileId: profileId, modelId: remainingModels[0].id }
        : allModelOptions.find(
            (option) =>
              option.ref.apiProfileId !== profileId ||
              option.ref.modelId !== modelId,
          )?.ref;

    setApiProfiles((current) =>
      current.map((candidate) =>
        candidate.id === profileId
          ? { ...candidate, models: remainingModels }
          : candidate,
      ),
    );
    setEditingModelId(remainingModels[0]?.id ?? "");
    setAssistants((current) =>
      current.map((assistant) => {
        const filteredBindings = assistant.modelBindings.filter(
          (binding) =>
            binding.apiProfileId !== profileId || binding.modelId !== modelId,
        );
        const hasDefault = filteredBindings.some(
          (binding) => binding.isDefault,
        );

        return {
          ...assistant,
          modelBindings: normalizeDefaultBinding(
            hasDefault
              ? filteredBindings
              : filteredBindings.map((binding, index) => ({
                  ...binding,
                  isDefault: index === 0,
                })),
          ),
        };
      }),
    );

    if (
      activeModelRef.apiProfileId === profileId &&
      activeModelRef.modelId === modelId &&
      nextModelRef
    ) {
      setActiveModelRef(nextModelRef);
    }
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
      key === "id" && typeof value === "string" ? value.trim() : modelId;

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

  const updateContextSummaryFrameworkInstruction = (
    sectionId: string,
    instruction: string,
  ) => {
    setContextSummaryFramework((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? { ...section, instruction } : section,
      ),
    }));
  };

  const resetContextSummaryFrameworkInstruction = (sectionId: string) => {
    const defaultSection = defaultContextSummaryFramework.sections.find(
      (section) => section.id === sectionId,
    );
    if (!defaultSection) {
      return;
    }

    updateContextSummaryFrameworkInstruction(
      sectionId,
      defaultSection.instruction,
    );
  };

  const resetContextSummaryFramework = () => {
    setContextSummaryFramework(defaultContextSummaryFramework);
  };

  const createContextProfile = () => {
    const newProfile = createEmptyContextProfile(contextProfiles.length + 1);
    setContextProfiles((current) => [...current, newProfile]);
    setEditingContextProfileId(newProfile.id);
  };

  const moveContextProfile = (profileId: string, direction: -1 | 1) => {
    setContextProfiles((current) =>
      moveListItemById(current, profileId, direction),
    );
  };

  const updateContextProfileField = (
    profileId: string,
    key: keyof Pick<ContextProfile, "name" | "description">,
    value: string,
  ) => {
    setContextProfiles((current) =>
      current.map((profile) =>
        profile.id === profileId ? { ...profile, [key]: value } : profile,
      ),
    );
  };

  const updateContextProfileOverride = (
    profileId: string,
    dimensionId: string,
    instruction: string,
  ) => {
    setContextProfiles((current) =>
      current.map((profile) => {
        if (profile.id !== profileId) {
          return profile;
        }

        const trimmedInstruction = instruction.trim();
        const existingOverride = profile.dimensionOverrides.find(
          (override) => override.dimensionId === dimensionId,
        );
        const enabled = existingOverride?.enabled !== false;
        const existingOverrides = profile.dimensionOverrides.filter(
          (override) => override.dimensionId !== dimensionId,
        );
        const nextOverrides =
          trimmedInstruction || !enabled
            ? [
                ...existingOverrides,
                {
                  dimensionId,
                  enabled,
                  instruction,
                },
              ]
            : existingOverrides;

        return {
          ...profile,
          dimensionOverrides: nextOverrides,
        };
      }),
    );
  };

  const clearContextProfileOverride = (
    profileId: string,
    dimensionId: string,
  ) => {
    updateContextProfileOverride(profileId, dimensionId, "");
  };

  const toggleContextProfileDimension = (
    profileId: string,
    dimensionId: string,
    enabled: boolean,
  ) => {
    setContextProfiles((current) =>
      current.map((profile) => {
        if (profile.id !== profileId) {
          return profile;
        }

        const existingOverride = getContextProfileOverride(
          profile,
          dimensionId,
        );
        const existingOverrides = profile.dimensionOverrides.filter(
          (override) => override.dimensionId !== dimensionId,
        );
        const instruction = existingOverride?.instruction ?? "";

        if (enabled && !instruction.trim()) {
          return {
            ...profile,
            dimensionOverrides: existingOverrides,
          };
        }

        return {
          ...profile,
          dimensionOverrides: [
            ...existingOverrides,
            {
              dimensionId,
              enabled,
              instruction,
            },
          ],
        };
      }),
    );
  };

  const resetContextProfile = (profileId: string) => {
    setContextProfiles((current) =>
      current.map((profile) =>
        profile.id === profileId
          ? { ...profile, dimensionOverrides: [] }
          : profile,
      ),
    );
  };

  const deleteContextProfile = (profileId: string) => {
    const targetProfile = contextProfiles.find(
      (profile) => profile.id === profileId,
    );
    if (!targetProfile) {
      return;
    }

    if (
      !confirmDestructiveAction(
        `删除上下文配置「${targetProfile.name}」？引用它的助手会切换到可用配置。`,
      )
    ) {
      return;
    }

    const remainingProfiles = contextProfiles.filter(
      (profile) => profile.id !== profileId,
    );
    const fallbackProfile = remainingProfiles[0] ?? {
      ...defaultContextProfile,
      id: createId("context-profile"),
    };
    const nextProfiles =
      remainingProfiles.length > 0 ? remainingProfiles : [fallbackProfile];

    setContextProfiles(nextProfiles);
    setEditingContextProfileId(fallbackProfile.id);
    setAssistants((current) =>
      current.map((assistant) =>
        assistant.contextProfileId === profileId
          ? { ...assistant, contextProfileId: fallbackProfile.id }
          : assistant,
      ),
    );
  };

  const deleteMessage = (messageId: string) => {
    const targetMessage = messages.find((message) => message.id === messageId);
    if (!targetMessage) {
      return;
    }
    if (!confirmDestructiveAction("删除这条消息？")) {
      return;
    }

    if (pendingMessageId === messageId) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setPendingMessageId(null);
    }

    const targetConversation = conversations.find(
      (conversation) => conversation.id === targetMessage.conversationId,
    );
    const conversationMessages = sortMessagesByCreatedAt(
      messages.filter(
        (message) => message.conversationId === targetMessage.conversationId,
      ),
    );
    const targetIndex = conversationMessages.findIndex(
      (message) => message.id === messageId,
    );
    const boundaryIndex = conversationMessages.findIndex(
      (message) =>
        message.id ===
        getActiveContextSummaryRecord(targetConversation)?.boundaryMessageId,
    );
    const shouldClearContextSummary =
      boundaryIndex >= 0 && targetIndex >= 0 && targetIndex <= boundaryIndex;

    setMessages((current) =>
      current.filter((message) => message.id !== messageId),
    );
    if (shouldClearContextSummary) {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === targetMessage.conversationId
            ? clearConversationContextSummary(conversation)
            : conversation,
        ),
      );
      setContextSummaryStatus("已清除上下文总结：删除了总结覆盖范围内的消息。");
    }
  };

  const runContextSummaryJob = async ({
    conversation,
    triggerSummarizableMessages,
    messagesToSummarize,
    boundaryMessage,
    nextBoundaryIndex,
    previousSummary,
    canReusePreviousSummary,
    summaryAssistant,
    summaryResolvedModel,
    contextProfile,
    trigger,
    statusText,
  }: {
    conversation: Conversation;
    triggerSummarizableMessages: Message[];
    messagesToSummarize: Message[];
    boundaryMessage: Message;
    nextBoundaryIndex: number;
    previousSummary?: ContextSummaryRecord;
    canReusePreviousSummary: boolean;
    summaryAssistant: Assistant;
    summaryResolvedModel: ResolvedModel;
    contextProfile: ContextProfile;
    trigger: "manual" | "auto";
    statusText: string;
  }) => {
    if (contextSummaryJobRunningRef.current) {
      return false;
    }

    contextSummaryJobRunningRef.current = true;
    setContextSummaryPending(true);
    setContextSummaryStatus(statusText);

    const now = new Date().toISOString();
    const summaryRequestMessage: Message = {
      id: createId("summary-request"),
      conversationId: conversation.id,
      role: "user",
      label: "上下文总结请求",
      text: buildContextSummaryPrompt({
        conversation,
        previousSummary: canReusePreviousSummary
          ? previousSummary?.text
          : undefined,
        messages: messagesToSummarize,
        framework: contextSummaryFramework,
        contextProfile,
      }),
      createdAt: now,
      status: "complete",
    };
    const controller = new AbortController();

    try {
      const result = await requestResponsesChat({
        apiProfile: summaryResolvedModel.apiProfile,
        assistant: summaryAssistant,
        conversation,
        model: summaryResolvedModel.model,
        messages: [summaryRequestMessage],
        signal: controller.signal,
        stream: false,
        webSearchEnabled: false,
      });
      const contextSummary = result.text.trim();

      if (!contextSummary) {
        throw new Error("总结助手未返回文本。");
      }

      const latestConversationMessages = sortMessagesByCreatedAt(
        latestSnapshotRef.current.messages.filter(
          (message) => message.conversationId === conversation.id,
        ),
      );
      const latestSummarizableMessages = latestConversationMessages.filter(
        (message) => message.status !== "streaming" && message.text.trim(),
      );
      let latestBoundaryIndex = latestSummarizableMessages.findIndex(
        (message) => message.id === boundaryMessage.id,
      );
      const effectiveSummarizableMessages =
        latestBoundaryIndex >= 0
          ? latestSummarizableMessages
          : triggerSummarizableMessages;
      latestBoundaryIndex = effectiveSummarizableMessages.findIndex(
        (message) => message.id === boundaryMessage.id,
      );

      if (latestBoundaryIndex < 0) {
        throw new Error("总结边界消息已被删除或失效，已放弃写入。");
      }

      const updatedAt = new Date().toISOString();
      const coveredMessageCount = nextBoundaryIndex + 1;
      const retainedRawMessages = Math.max(
        0,
        effectiveSummarizableMessages.length - coveredMessageCount,
      );
      const source = createSourceSnapshot(
        summaryAssistant,
        summaryResolvedModel,
      );
      const summaryRecord: ContextSummaryRecord = {
        id: createId("context-summary"),
        kind: "rolling",
        status: "active",
        schemaVersion: contextSummaryFramework.schemaVersion,
        text: contextSummary,
        boundaryMessageId: boundaryMessage.id,
        coveredMessageCount,
        retainedRawMessageCount: retainedRawMessages,
        createdAt: updatedAt,
        updatedAt,
        previousSummaryId: previousSummary?.id,
        source,
        frameworkId: contextSummaryFramework.id,
        frameworkNameSnapshot: contextSummaryFramework.name,
        frameworkSectionsSnapshot: createEffectiveContextSummarySections(
          contextSummaryFramework,
          contextProfile,
        ),
        contextProfileId: contextProfile.id,
        contextProfileNameSnapshot: contextProfile.name,
        contextProfileDimensionOverridesSnapshot:
          contextProfile.dimensionOverrides,
      };

      setConversations((current) =>
        current.map((candidate) =>
          candidate.id === conversation.id
            ? {
                ...candidate,
                contextSummaries: [summaryRecord],
                activeContextSummaryId: summaryRecord.id,
              }
            : candidate,
        ),
      );
      setContextSummaryStatus(
        trigger === "auto"
          ? `后台已总结到 ${coveredMessageCount} 条，当前还有 ${retainedRawMessages} 条未总结 · ${formatMessageTime(
              updatedAt,
            )}`
          : `已总结 ${coveredMessageCount} 条历史消息，保留最近 ${retainedRawMessages} 条原文 · ${formatMessageTime(
              updatedAt,
            )}`,
      );
      return true;
    } catch (error) {
      setContextSummaryStatus(
        error instanceof Error
          ? `${
              trigger === "auto" ? "自动上下文总结" : "上下文总结"
            }失败：${error.message}`
          : `${
              trigger === "auto" ? "自动上下文总结" : "上下文总结"
            }失败，请检查总结助手配置。`,
      );
      return false;
    } finally {
      contextSummaryJobRunningRef.current = false;
      setContextSummaryPending(false);
    }
  };

  const summarizeActiveConversation = async () => {
    if (
      !activeConversation ||
      activeConversationReadOnly ||
      pendingMessageId ||
      contextSummaryPending
    ) {
      return;
    }

    if (!contextSummaryAssistant) {
      setContextSummaryStatus("没有可用的功能助手用于上下文总结。");
      return;
    }

    if (!contextSummaryResolvedModel) {
      setContextSummaryStatus(
        getUtilityAssistantModelStrategy(contextSummaryAssistant) === "fixed"
          ? "总结助手指定模型不可用。请在设置页为当前上下文总结助手绑定可用模型，或改为跟随当前对话模型。"
          : "当前对话没有可用模型，无法执行上下文总结。",
      );
      return;
    }

    if (
      createEffectiveContextSummarySections(
        contextSummaryFramework,
        activeContextProfile,
      ).length === 0
    ) {
      setContextSummaryStatus("当前上下文配置未启用任何维度，已跳过总结。");
      return;
    }

    const summarizableMessages = activeMessages.filter(
      (message) => message.status !== "streaming" && message.text.trim(),
    );
    if (summarizableMessages.length === 0) {
      setContextSummaryStatus("当前没有可总结的已完成消息。");
      return;
    }

    const rawTailMessages = contextSummaryRawTailMessages;
    const usesShortConversationOverride =
      rawTailMessages > 0 && summarizableMessages.length <= rawTailMessages;
    const nextBoundaryIndex = usesShortConversationOverride
      ? summarizableMessages.length - 1
      : summarizableMessages.length - rawTailMessages - 1;

    const previousBoundaryIndex = summarizableMessages.findIndex(
      (message) => message.id === activeContextSummary?.boundaryMessageId,
    );
    const canReusePreviousSummary =
      Boolean(activeContextSummary?.text.trim()) &&
      previousBoundaryIndex >= 0 &&
      previousBoundaryIndex <= nextBoundaryIndex;
    const messagesToSummarize = summarizableMessages.slice(
      canReusePreviousSummary ? previousBoundaryIndex + 1 : 0,
      nextBoundaryIndex + 1,
    );
    const boundaryMessage = summarizableMessages[nextBoundaryIndex];

    if (messagesToSummarize.length === 0 || !boundaryMessage) {
      setContextSummaryStatus("上下文总结已是最新，无新增消息需要合并。");
      return;
    }

    await runContextSummaryJob({
      conversation: activeConversation,
      triggerSummarizableMessages: summarizableMessages,
      messagesToSummarize,
      boundaryMessage,
      nextBoundaryIndex,
      previousSummary: activeContextSummary,
      canReusePreviousSummary,
      summaryAssistant: contextSummaryAssistant,
      summaryResolvedModel: contextSummaryResolvedModel,
      contextProfile: activeContextProfile,
      trigger: "manual",
      statusText: usesShortConversationOverride
        ? `正在总结 ${messagesToSummarize.length} 条旧消息；消息少于尾部保留 ${rawTailMessages} 条，按调试操作执行。`
        : `正在总结 ${messagesToSummarize.length} 条旧消息，前台消息不会刷新。`,
    });
  };

  const maybeStartAutoContextSummary = ({
    conversation,
    messageSnapshot,
    chatResolvedModel,
    contextProfile,
  }: {
    conversation: Conversation;
    messageSnapshot: Message[];
    chatResolvedModel: ResolvedModel;
    contextProfile: ContextProfile;
  }) => {
    if (
      conversation.archived ||
      contextSummaryAutoMessageInterval <= 0 ||
      contextSummaryJobRunningRef.current ||
      !contextSummaryAssistant
    ) {
      return;
    }

    const summaryResolvedModel = resolveUtilityAssistantModel(
      contextSummaryAssistant,
      chatResolvedModel,
      apiProfiles,
    );

    if (!summaryResolvedModel) {
      return;
    }

    if (
      createEffectiveContextSummarySections(
        contextSummaryFramework,
        contextProfile,
      ).length === 0
    ) {
      return;
    }

    const summarizableMessages = sortMessagesByCreatedAt(
      messageSnapshot.filter(
        (message) => message.status !== "streaming" && message.text.trim(),
      ),
    );
    if (summarizableMessages.length === 0) {
      return;
    }

    const previousSummary = getActiveContextSummaryRecord(conversation);
    const previousBoundaryIndex = summarizableMessages.findIndex(
      (message) => message.id === previousSummary?.boundaryMessageId,
    );
    const canReusePreviousSummary =
      Boolean(previousSummary?.text.trim()) && previousBoundaryIndex >= 0;
    const summarizedMessageCount = canReusePreviousSummary
      ? previousBoundaryIndex + 1
      : 0;
    const pendingMessageCount =
      summarizableMessages.length - summarizedMessageCount;

    if (pendingMessageCount < contextSummaryAutoMessageInterval) {
      return;
    }

    const nextBoundaryIndex = summarizableMessages.length - 1;
    const boundaryMessage = summarizableMessages[nextBoundaryIndex];
    const messagesToSummarize = summarizableMessages.slice(
      canReusePreviousSummary ? previousBoundaryIndex + 1 : 0,
      nextBoundaryIndex + 1,
    );

    if (!boundaryMessage || messagesToSummarize.length === 0) {
      return;
    }

    void runContextSummaryJob({
      conversation,
      triggerSummarizableMessages: summarizableMessages,
      messagesToSummarize,
      boundaryMessage,
      nextBoundaryIndex,
      previousSummary,
      canReusePreviousSummary,
      summaryAssistant: contextSummaryAssistant,
      summaryResolvedModel,
      contextProfile,
      trigger: "auto",
      statusText: `后台总结中：触发点 ${nextBoundaryIndex + 1} 条，前台对话不受影响。`,
    });
  };

  const retryAssistantMessage = async (messageId: string) => {
    if (!activeConversation || activeConversationReadOnly || pendingMessageId) {
      return;
    }

    const messageIndex = activeMessages.findIndex(
      (message) => message.id === messageId,
    );
    const targetMessage = activeMessages[messageIndex];
    if (!targetMessage || targetMessage.role !== "assistant") {
      return;
    }

    const requestMessages = activeMessages.slice(0, messageIndex);
    const lastUserMessage = [...requestMessages]
      .reverse()
      .find((message) => message.role === "user");
    if (!lastUserMessage) {
      return;
    }

    const idsToRemove = new Set(
      activeMessages.slice(messageIndex).map((message) => message.id),
    );
    const resolvedModel = activeResolvedModel;

    if (!resolvedModel) {
      const errorMessage: Message = {
        id: createId("assistant"),
        conversationId: activeConversation.id,
        role: "assistant",
        label: activeAssistant.name,
        text: "当前助手没有可用模型。请先在设置页为助手绑定启用的模型。",
        createdAt: new Date().toISOString(),
        status: "error",
      };
      setMessages((current) => [
        ...current.filter((message) => !idsToRemove.has(message.id)),
        errorMessage,
      ]);
      return;
    }

    const source = createSourceSnapshot(activeAssistant, resolvedModel);
    const requestStartedAt = Date.now();
    const requestWebSearchEnabled = nextTurnWebSearchEnabled;
    const assistantMessage: Message = {
      id: createId("assistant"),
      conversationId: activeConversation.id,
      role: "assistant",
      label: `${activeAssistant.name} · ${resolvedModel.model.name}`,
      text: streamingEnabled ? "正在等待流式输出…" : "正在请求模型…",
      createdAt: new Date(requestStartedAt).toISOString(),
      status: "streaming",
      source,
    };
    const controller = new AbortController();
    let streamedText = "";

    abortControllerRef.current = controller;
    setNextTurnWebSearchEnabled(false);
    setNextTurnMultimodalEnabled(false);
    setLastObservedUsage(undefined);
    setMessages((current) => [
      ...current.filter((message) => !idsToRemove.has(message.id)),
      assistantMessage,
    ]);
    setPendingMessageId(assistantMessage.id);
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              summary: `最近重试：${lastUserMessage.text.slice(0, 28)}`,
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
        contextInstruction: activeContextInstruction,
        messages: projectMessagesForRequest(
          activeConversation,
          requestMessages,
        ),
        signal: controller.signal,
        stream: streamingEnabled,
        webSearchEnabled: requestWebSearchEnabled,
        onTextDelta: streamingEnabled
          ? (_delta, fullText) => {
              streamedText = fullText;
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessage.id
                    ? {
                        ...message,
                        text:
                          fullText ||
                          (streamingEnabled
                            ? "正在等待流式输出…"
                            : "正在请求模型…"),
                      }
                    : message,
                ),
              );
            }
          : undefined,
      });

      setLastObservedUsage(result.usage);
      const completionTiming = createCompletionTiming(requestStartedAt);
      const completedAssistantMessage: Message = {
        ...assistantMessage,
        status: "complete",
        ...completionTiming,
        text: result.text || streamedText || "模型未返回文本内容。",
        providerResponseId: result.providerResponseId,
        usage: result.usage,
      };
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? completedAssistantMessage
            : message,
        ),
      );
      maybeStartAutoContextSummary({
        conversation: activeConversation,
        messageSnapshot: [...requestMessages, completedAssistantMessage],
        chatResolvedModel: resolvedModel,
        contextProfile: activeContextProfile,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      const completionTiming = createCompletionTiming(requestStartedAt);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                status: "error",
                ...completionTiming,
                text:
                  error instanceof Error
                    ? error.message
                    : "请求模型失败，请检查连接、模型和网络。",
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

  const regenerateFromUserMessage = async (messageId: string) => {
    if (!activeConversation || activeConversationReadOnly || pendingMessageId) {
      return;
    }

    const messageIndex = activeMessages.findIndex(
      (message) => message.id === messageId,
    );
    const targetMessage = activeMessages[messageIndex];
    if (!targetMessage || targetMessage.role !== "user") {
      return;
    }

    const requestMessages = activeMessages.slice(0, messageIndex + 1);
    const idsToRemove = new Set(
      activeMessages.slice(messageIndex + 1).map((message) => message.id),
    );
    const resolvedModel = activeResolvedModel;

    if (!resolvedModel) {
      const errorMessage: Message = {
        id: createId("assistant"),
        conversationId: activeConversation.id,
        role: "assistant",
        label: activeAssistant.name,
        text: "当前助手没有可用模型。请先在设置页为助手绑定启用的模型。",
        createdAt: new Date().toISOString(),
        status: "error",
      };
      setMessages((current) => [
        ...current.filter((message) => !idsToRemove.has(message.id)),
        errorMessage,
      ]);
      return;
    }

    const source = createSourceSnapshot(activeAssistant, resolvedModel);
    const requestStartedAt = Date.now();
    const requestWebSearchEnabled = nextTurnWebSearchEnabled;
    const assistantMessage: Message = {
      id: createId("assistant"),
      conversationId: activeConversation.id,
      role: "assistant",
      label: `${activeAssistant.name} · ${resolvedModel.model.name}`,
      text: streamingEnabled ? "正在等待流式输出…" : "正在请求模型…",
      createdAt: new Date(requestStartedAt).toISOString(),
      status: "streaming",
      source,
    };
    const controller = new AbortController();
    let streamedText = "";

    abortControllerRef.current = controller;
    setNextTurnWebSearchEnabled(false);
    setNextTurnMultimodalEnabled(false);
    setLastObservedUsage(undefined);
    setMessages((current) => [
      ...current.filter((message) => !idsToRemove.has(message.id)),
      assistantMessage,
    ]);
    setPendingMessageId(assistantMessage.id);
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              summary: `最近重答：${targetMessage.text.slice(0, 28)}`,
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
        contextInstruction: activeContextInstruction,
        messages: projectMessagesForRequest(
          activeConversation,
          requestMessages,
        ),
        signal: controller.signal,
        stream: streamingEnabled,
        webSearchEnabled: requestWebSearchEnabled,
        onTextDelta: streamingEnabled
          ? (_delta, fullText) => {
              streamedText = fullText;
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessage.id
                    ? {
                        ...message,
                        text:
                          fullText ||
                          (streamingEnabled
                            ? "正在等待流式输出…"
                            : "正在请求模型…"),
                      }
                    : message,
                ),
              );
            }
          : undefined,
      });

      setLastObservedUsage(result.usage);
      const completionTiming = createCompletionTiming(requestStartedAt);
      const completedAssistantMessage: Message = {
        ...assistantMessage,
        status: "complete",
        ...completionTiming,
        text: result.text || streamedText || "模型未返回文本内容。",
        providerResponseId: result.providerResponseId,
        usage: result.usage,
      };
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? completedAssistantMessage
            : message,
        ),
      );
      maybeStartAutoContextSummary({
        conversation: activeConversation,
        messageSnapshot: [...requestMessages, completedAssistantMessage],
        chatResolvedModel: resolvedModel,
        contextProfile: activeContextProfile,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      const completionTiming = createCompletionTiming(requestStartedAt);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                status: "error",
                ...completionTiming,
                text:
                  error instanceof Error
                    ? error.message
                    : "请求模型失败，请检查连接、模型和网络。",
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

  const sendMessage = async () => {
    const text = draft.trim();
    const resolvedModel = activeResolvedModel;

    if (
      !text ||
      !activeConversation ||
      activeConversationReadOnly ||
      pendingMessageId
    ) {
      return;
    }

    if (!resolvedModel) {
      const assistantMessage: Message = {
        id: createId("assistant"),
        conversationId: activeConversation.id,
        role: "assistant",
        label: activeAssistant.name,
        text: "当前助手没有可用模型。请先在设置页为助手绑定启用的模型。",
        createdAt: new Date().toISOString(),
        status: "error",
      };
      setDraft("");
      setMessages((current) => [...current, assistantMessage]);
      return;
    }

    const source = createSourceSnapshot(activeAssistant, resolvedModel);
    const { userCreatedAt, assistantCreatedAt } = createTurnTimestamps();
    const requestStartedAt = Date.parse(assistantCreatedAt);
    const requestWebSearchEnabled = nextTurnWebSearchEnabled;
    const userMessage: Message = {
      id: createId("message"),
      conversationId: activeConversation.id,
      role: "user",
      label: "用户",
      text,
      createdAt: userCreatedAt,
      status: "complete",
      source,
    };
    const assistantMessage: Message = {
      id: createId("assistant"),
      conversationId: activeConversation.id,
      role: "assistant",
      label: `${activeAssistant.name} · ${resolvedModel.model.name}`,
      text: streamingEnabled ? "正在等待流式输出…" : "正在请求模型…",
      createdAt: assistantCreatedAt,
      status: "streaming",
      source,
    };
    const controller = new AbortController();
    let streamedText = "";

    abortControllerRef.current = controller;
    setDraft("");
    setNextTurnWebSearchEnabled(false);
    setNextTurnMultimodalEnabled(false);
    setLastObservedUsage(undefined);
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
        contextInstruction: activeContextInstruction,
        messages: projectMessagesForRequest(activeConversation, [
          ...activeMessages,
          userMessage,
        ]),
        signal: controller.signal,
        stream: streamingEnabled,
        webSearchEnabled: requestWebSearchEnabled,
        onTextDelta: streamingEnabled
          ? (_delta, fullText) => {
              streamedText = fullText;
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessage.id
                    ? {
                        ...message,
                        text:
                          fullText ||
                          (streamingEnabled
                            ? "正在等待流式输出…"
                            : "正在请求模型…"),
                      }
                    : message,
                ),
              );
            }
          : undefined,
      });

      setLastObservedUsage(result.usage);
      const completionTiming = createCompletionTiming(requestStartedAt);
      const completedAssistantMessage: Message = {
        ...assistantMessage,
        status: "complete",
        ...completionTiming,
        text: result.text || streamedText || "模型未返回文本内容。",
        providerResponseId: result.providerResponseId,
        usage: result.usage,
      };
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? completedAssistantMessage
            : message,
        ),
      );
      maybeStartAutoContextSummary({
        conversation: activeConversation,
        messageSnapshot: [
          ...activeMessages,
          userMessage,
          completedAssistantMessage,
        ],
        chatResolvedModel: resolvedModel,
        contextProfile: activeContextProfile,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      const completionTiming = createCompletionTiming(requestStartedAt);
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                status: "error",
                ...completionTiming,
                text:
                  error instanceof Error
                    ? error.message
                    : "请求模型失败，请检查连接、模型和网络。",
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

  const insertComposerNewline = () => {
    const input = composerInputRef.current;
    const selectionStart = input?.selectionStart ?? draft.length;
    const selectionEnd = input?.selectionEnd ?? draft.length;
    const nextDraft = `${draft.slice(0, selectionStart)}\n${draft.slice(
      selectionEnd,
    )}`;

    setDraft(nextDraft);
    window.requestAnimationFrame(() => {
      const nextInput = composerInputRef.current;
      if (!nextInput) {
        return;
      }

      const cursor = selectionStart + 1;
      nextInput.selectionStart = cursor;
      nextInput.selectionEnd = cursor;
      resizeComposerInput();
    });
  };

  const sendOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent;
    if ("isComposing" in nativeEvent && nativeEvent.isComposing) {
      return;
    }

    if (event.ctrlKey && !event.altKey && !event.metaKey) {
      const key = event.key.toLocaleLowerCase();
      if (key === "j") {
        event.preventDefault();
        insertComposerNewline();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        void sendMessage();
        return;
      }
    }

    if (event.key !== "Enter") {
      return;
    }

    if (composerSubmitMode === "ctrl-enter-send") {
      return;
    }

    if (event.shiftKey || event.altKey || event.metaKey) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  };

  const scrollMessageThreadToEdge = () => {
    const thread = messageThreadRef.current;
    if (scrollShortcutTarget === "top") {
      thread?.scrollTo({ top: 0, behavior: "smooth" });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    thread?.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  };

  const renderInspectorMessageList = (
    title: string,
    list: Message[],
    emptyText: string,
  ) => (
    <section className="inspector-card">
      <h3>
        <span>{title}</span>
        <small>{list.length} 条</small>
      </h3>
      {list.length > 0 ? (
        <div className="inspector-message-list">
          {list.map((message) => {
            const absoluteIndex =
              activeMessages.findIndex((item) => item.id === message.id) + 1;
            const source = message.source
              ? `${message.source.assistantName} / ${message.source.modelName}`
              : "";

            return (
              <article className="inspector-message" key={message.id}>
                <header>
                  <strong>
                    {absoluteIndex > 0 ? `#${absoluteIndex} · ` : ""}
                    {message.label ||
                      (message.role === "user" ? "用户" : "助手")}
                  </strong>
                  <span>
                    {message.role}
                    {message.status ? ` · ${message.status}` : ""}
                    {source ? ` · ${source}` : ""}
                    {formatMessageTime(message.createdAt)
                      ? ` · ${formatMessageTime(message.createdAt)}`
                      : ""}
                  </span>
                </header>
                <p>{message.text.trim() || "[空消息]"}</p>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="inspector-empty">{emptyText}</p>
      )}
    </section>
  );

  return (
    <main
      className={`app-shell ${
        layoutMode === "desktop"
          ? "desktop-layout"
          : layoutMode === "mobile"
            ? "mobile-layout"
            : ""
      }`}
      onTouchStart={handleDrawerSwipeStart}
      onTouchEnd={handleDrawerSwipeEnd}
      onTouchCancel={cancelDrawerSwipe}
    >
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
            <h1>{showArchived ? "归档" : "对话"}</h1>
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
            placeholder={showArchived ? "搜索归档标题或摘要" : "搜索标题或摘要"}
            value={conversationSearch}
            onChange={(event) => setConversationSearch(event.target.value)}
          />
        </label>

        <nav
          className="conversation-list"
          aria-label={showArchived ? "归档对话列表" : "对话列表"}
        >
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
            <p className="empty-list">
              {showArchived ? "没有匹配的归档对话" : "没有匹配的对话"}
            </p>
          ) : null}
        </nav>

        <footer className="rail-footer">
          <button
            type="button"
            onClick={
              showArchived ? openActiveConversations : openArchivedConversations
            }
          >
            <Archive size={18} />
            {showArchived
              ? "返回对话"
              : `已归档${archivedConversations.length ? `(${archivedConversations.length})` : ""}`}
          </button>
          <button
            type="button"
            disabled={!activeConversation}
            onClick={
              activeConversation?.archived
                ? restoreActiveConversation
                : archiveActiveConversation
            }
          >
            {activeConversation?.archived ? (
              <RotateCcw size={18} />
            ) : (
              <Archive size={18} />
            )}
            {activeConversation?.archived ? "恢复当前" : "归档"}
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={!activeConversation}
            onClick={deleteActiveConversation}
          >
            <Trash2 size={18} />
            删除
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
          <button
            className="icon-button mobile-only chat-settings-button"
            type="button"
            aria-label="打开设置"
            onClick={openSettings}
          >
            <Settings size={20} />
          </button>
          <div className="chat-pickers">
            <div className="assistant-picker">
              <Bot size={18} />
              <span className="sr-only">选择助手</span>
              <CustomSelect
                label="选择助手"
                value={activeAssistant.id}
                options={chatAssistants.map((assistant) => ({
                  value: assistant.id,
                  label: assistant.name,
                }))}
                onChange={activateAssistant}
              />
            </div>
            <div className="assistant-picker model-picker">
              <Server size={18} />
              <span className="sr-only">选择模型</span>
              <CustomSelect
                label="选择模型"
                disabled={assistantModelOptions.length === 0}
                value={
                  activeResolvedModel
                    ? modelRefKey(activeResolvedModel.ref)
                    : modelRefKey(DEFAULT_MODEL_REF)
                }
                options={assistantModelOptions.map((option) => ({
                  value: option.key,
                  label: option.model.name,
                }))}
                onChange={(nextValue) =>
                  setActiveModelRef(parseModelRefKey(nextValue))
                }
              />
            </div>
          </div>
        </header>

        <div className="message-thread-shell">
          <div
            className="message-thread"
            aria-label="消息列表"
            ref={messageThreadRef}
            onScroll={updateScrollShortcutTarget}
          >
            {activeMessages.length > 0 ? (
              activeMessages.map((message) => {
                const createdTime = formatMessageTime(message.createdAt);
                const completedTime = formatMessageTime(message.completedAt);
                const elapsedText = formatElapsedMs(message.elapsedMs);

                return (
                  <article
                    className={`message ${message.role}`}
                    key={message.id}
                  >
                    <div className="message-label">
                      {message.label}
                      {createdTime ? ` · ${createdTime}` : ""}
                      {message.status === "streaming" ? " · 生成中" : ""}
                      {message.status === "stopped" ? " · 已停止" : ""}
                      {message.status === "error" ? " · 错误" : ""}
                    </div>
                    <p>{message.text}</p>
                    {completedTime || elapsedText ? (
                      <div className="message-meta">
                        {completedTime ? (
                          <span>完成 {completedTime}</span>
                        ) : null}
                        {elapsedText ? <span>用时 {elapsedText}</span> : null}
                      </div>
                    ) : null}
                    <div className="message-actions">
                      {message.role === "assistant" ? (
                        <button
                          type="button"
                          aria-label="重试回复"
                          disabled={
                            activeConversationReadOnly ||
                            Boolean(pendingMessageId)
                          }
                          onClick={() => void retryAssistantMessage(message.id)}
                        >
                          <RotateCcw size={14} />
                          重试
                        </button>
                      ) : null}
                      {message.role === "user" ? (
                        <button
                          type="button"
                          aria-label="重答消息"
                          disabled={
                            activeConversationReadOnly ||
                            Boolean(pendingMessageId)
                          }
                          onClick={() =>
                            void regenerateFromUserMessage(message.id)
                          }
                        >
                          <RotateCcw size={14} />
                          重答
                        </button>
                      ) : null}
                      <button
                        type="button"
                        aria-label="删除消息"
                        onClick={() => deleteMessage(message.id)}
                      >
                        <Trash2 size={14} />
                        删除
                      </button>
                    </div>
                  </article>
                );
              })
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
          <button
            className="message-scroll-action"
            type="button"
            aria-label={
              scrollShortcutTarget === "top" ? "回到消息顶部" : "回到消息底部"
            }
            onClick={scrollMessageThreadToEdge}
          >
            {scrollShortcutTarget === "top" ? "↑ 顶部" : "↓ 底部"}
          </button>
        </div>

        {debugEnabled ? (
          <section
            className={`diagnostics-panel ${
              diagnosticsPanelExpanded ? "expanded" : "collapsed"
            }`}
            aria-label="调试诊断"
          >
            <header>
              {isCompactLayout ? (
                <button
                  className="diagnostics-toggle"
                  type="button"
                  aria-expanded={diagnosticsPanelExpanded}
                  onClick={() =>
                    setMobileDiagnosticsExpanded((isExpanded) => !isExpanded)
                  }
                >
                  <span>
                    <SlidersHorizontal size={18} />
                    调试诊断
                  </span>
                  <small>{diagnosticsBrief}</small>
                  <span aria-hidden="true">
                    {diagnosticsPanelExpanded ? "收起" : "展开"}
                  </span>
                </button>
              ) : (
                <>
                  <SlidersHorizontal size={18} />
                  <span>Context diagnostics</span>
                </>
              )}
            </header>
            {diagnosticsPanelExpanded ? (
              <>
                <div className="diagnostic-grid">
                  {diagnostics.map(([label, value]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <div className="context-summary-tools" role="status">
                  <button
                    type="button"
                    disabled={
                      activeConversationReadOnly ||
                      Boolean(pendingMessageId) ||
                      contextSummaryPending
                    }
                    onClick={() => void summarizeActiveConversation()}
                  >
                    {contextSummaryPending ? "正在总结…" : "总结上下文"}
                  </button>
                  <button
                    type="button"
                    disabled={!activeContextSummary?.text.trim()}
                    onClick={() =>
                      setContextSummaryPreviewOpen((isOpen) => !isOpen)
                    }
                  >
                    {contextSummaryPreviewOpen ? "隐藏总结" : "显示总结"}
                  </button>
                  <button
                    type="button"
                    disabled={!activeConversation}
                    onClick={() => setDataInspectorOpen(true)}
                  >
                    数据检查器
                  </button>
                  <span>
                    {contextSummaryStatus ||
                      (activeContextSummary?.updatedAt
                        ? `上下文总结：${activeContextSummary.coveredMessageCount} 条 · ${formatMessageTime(
                            activeContextSummary.updatedAt,
                          )}`
                        : "上下文总结未生成")}
                  </span>
                </div>
                {contextSummaryPreviewOpen &&
                activeContextSummary?.text.trim() ? (
                  <pre
                    className="context-summary-preview"
                    aria-label="当前上下文总结"
                  >
                    {activeContextSummary.text}
                  </pre>
                ) : null}
              </>
            ) : null}
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
          <div className="composer-stack">
            <textarea
              ref={composerInputRef}
              rows={2}
              placeholder={
                activeConversationReadOnly
                  ? "归档对话仅浏览，恢复后可继续"
                  : nextTurnMultimodalEnabled
                    ? "当前仍仅发送文本；图片/文件内容选择后续接入"
                    : "输入消息"
              }
              disabled={activeConversationReadOnly}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={sendOnEnter}
            />
            <div className="turn-options" aria-label="本轮选项">
              <button
                className={`option-chip ${
                  nextTurnWebSearchEnabled ? "active" : ""
                }`}
                type="button"
                aria-label="本轮联网"
                aria-pressed={nextTurnWebSearchEnabled}
                disabled={
                  activeConversationReadOnly || Boolean(pendingMessageId)
                }
                onClick={() =>
                  setNextTurnWebSearchEnabled((enabled) => !enabled)
                }
              >
                <Search size={14} />
                联网
              </button>
              <button
                className={`option-chip ${
                  nextTurnMultimodalEnabled ? "active" : ""
                }`}
                type="button"
                aria-label="本轮多模态"
                aria-pressed={nextTurnMultimodalEnabled}
                disabled={
                  activeConversationReadOnly || Boolean(pendingMessageId)
                }
                onClick={() =>
                  setNextTurnMultimodalEnabled((enabled) => !enabled)
                }
                title="当前是单轮临时开关预留；图片/文件选择与发送后续接入。"
              >
                <Plus size={14} />
                多模态
              </button>
            </div>
          </div>
          <button
            className="send-button"
            type="button"
            aria-label="发送"
            disabled={
              !draft.trim() ||
              activeConversationReadOnly ||
              Boolean(pendingMessageId)
            }
            onClick={() => void sendMessage()}
          >
            <Send size={18} />
          </button>
        </footer>
      </section>

      {dataInspectorOpen ? (
        <div
          className="modal-backdrop data-inspector-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDataInspectorOpen(false);
            }
          }}
        >
          <section
            className="data-inspector-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-inspector-title"
          >
            <header>
              <div>
                <p className="eyebrow">Read only</p>
                <h2 id="data-inspector-title">数据检查器</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭数据检查器"
                onClick={() => setDataInspectorOpen(false)}
              >
                <X size={18} />
              </button>
            </header>

            <p className="inspector-note">
              只读取当前前端状态，用于验证 MobileChatDB 记录、当前对话 summary
              diff 和下一次请求投影；不会写回数据。
            </p>

            <div className="inspector-kpi-grid" aria-label="数据检查概览">
              <div>
                <span>当前对话消息</span>
                <strong>{activeMessages.length}</strong>
              </div>
              <div>
                <span>Summary 覆盖</span>
                <strong>
                  {activeContextSummaryCoveredMessages.length}
                  {activeContextSummary && activeContextSummaryBoundaryIndex < 0
                    ? " · 边界丢失"
                    : ""}
                </strong>
              </div>
              <div>
                <span>保留 tail</span>
                <strong>{activeContextSummaryRetainedMessages.length}</strong>
              </div>
              <div>
                <span>请求投影</span>
                <strong>{activeProjectedMessages.length}</strong>
              </div>
            </div>

            <div className="inspector-grid">
              <section className="inspector-card">
                <h3>数据库概览</h3>
                <pre>{formatInspectorJson(dataInspectorOverview)}</pre>
              </section>
              <section className="inspector-card">
                <h3>当前对话</h3>
                <pre>{formatInspectorJson(dataInspectorConversation)}</pre>
              </section>
              <section className="inspector-card">
                <h3>Summary diff</h3>
                <pre>{formatInspectorJson(dataInspectorSummaryDiff)}</pre>
              </section>
              <section className="inspector-card">
                <h3>当前 Summary</h3>
                <pre>
                  {activeContextSummary?.text.trim() ||
                    "当前对话没有 active summary。"}
                </pre>
              </section>
            </div>

            <div className="inspector-message-grid">
              {renderInspectorMessageList(
                "覆盖原文",
                activeContextSummaryCoveredMessages,
                activeContextSummary
                  ? "未找到 summary 边界，无法解析覆盖原文。"
                  : "当前对话没有 active summary。",
              )}
              {renderInspectorMessageList(
                "保留 tail",
                activeContextSummaryRetainedMessages,
                activeContextSummary
                  ? "summary 已覆盖到最后一条消息。"
                  : "无 active summary 时，所有消息都会按原文投影。",
              )}
              {renderInspectorMessageList(
                "请求投影",
                activeProjectedMessages,
                "当前没有可投影消息。",
              )}
            </div>

            <section className="inspector-card inspector-full">
              <h3>只读 JSON</h3>
              <details>
                <summary>当前对话 JSON</summary>
                <pre>{formatInspectorJson(activeConversation ?? null)}</pre>
              </details>
              <details>
                <summary>当前对话消息 JSON</summary>
                <pre>{formatInspectorJson(activeMessages)}</pre>
              </details>
              <details>
                <summary>请求投影 JSON</summary>
                <pre>{formatInspectorJson(activeProjectedMessages)}</pre>
              </details>
              <details>
                <summary>当前设置 JSON</summary>
                <pre>{formatInspectorJson(appSettings)}</pre>
              </details>
            </section>
          </section>
        </div>
      ) : null}

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
              <div className="settings-row compact theme-select">
                <span>
                  <Palette size={16} />
                  主题模式
                </span>
                <CustomSelect
                  label="主题模式"
                  value={themeMode}
                  options={Object.entries(themeLabels).map(
                    ([optionValue, optionLabel]) => ({
                      value: optionValue,
                      label: optionLabel,
                    }),
                  )}
                  onChange={(nextValue) => setThemeMode(nextValue as ThemeMode)}
                />
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
              <div className="settings-row compact number-setting">
                <span>总结保留原文</span>
                <input
                  aria-label="总结保留原文条数"
                  max={50}
                  min={0}
                  type="number"
                  value={contextSummaryRawTailMessages}
                  onChange={(event) =>
                    setContextSummaryRawTailMessages(
                      normalizeContextSummaryRawTailMessages(
                        Number(event.target.value),
                      ),
                    )
                  }
                />
              </div>
              <div className="settings-row compact number-setting">
                <span>自动总结间隔</span>
                <input
                  aria-label="自动总结间隔条数"
                  max={100}
                  min={0}
                  type="number"
                  value={contextSummaryAutoMessageInterval}
                  onChange={(event) =>
                    setContextSummaryAutoMessageInterval(
                      normalizeContextSummaryAutoMessageInterval(
                        Number(event.target.value),
                      ),
                    )
                  }
                />
              </div>
              <div className="settings-row compact theme-select wide-setting">
                <span>输入快捷键</span>
                <div className="setting-control-stack">
                  <CustomSelect
                    label="输入快捷键"
                    value={composerSubmitMode}
                    options={Object.entries(composerSubmitModeLabels).map(
                      ([optionValue, optionLabel]) => ({
                        value: optionValue,
                        label: optionLabel,
                      }),
                    )}
                    onChange={(nextValue) =>
                      setComposerSubmitMode(nextValue as ComposerSubmitMode)
                    }
                  />
                  <small>Ctrl+J 始终插入换行。</small>
                </div>
              </div>
              <div className="settings-row compact theme-select">
                <span>布局模式</span>
                <CustomSelect
                  label="布局模式"
                  value={layoutMode}
                  options={Object.entries(layoutLabels).map(
                    ([optionValue, optionLabel]) => ({
                      value: optionValue,
                      label: optionLabel,
                    }),
                  )}
                  onChange={(nextValue) =>
                    setLayoutMode(nextValue as LayoutMode)
                  }
                />
              </div>
              <div className="settings-row compact">
                <span>连接配置</span>
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
              <div className="settings-row compact">
                <span>上下文配置</span>
                <strong>{contextProfiles.length}</strong>
              </div>
              <div className="settings-row compact theme-select">
                <span>上下文总结助手</span>
                <CustomSelect
                  label="上下文总结助手"
                  value={utilityAssistantRefs.contextSummaryAssistantId}
                  options={utilityAssistants.map((assistant) => ({
                    value: assistant.id,
                    label: assistant.name,
                  }))}
                  onChange={(nextValue) =>
                    setUtilityAssistantRefs((current) => ({
                      ...current,
                      contextSummaryAssistantId: nextValue,
                    }))
                  }
                />
              </div>
              <div className="settings-row compact theme-select">
                <span>上下文压缩助手</span>
                <CustomSelect
                  label="上下文压缩助手"
                  value={utilityAssistantRefs.contextCompressionAssistantId}
                  options={utilityAssistants.map((assistant) => ({
                    value: assistant.id,
                    label: assistant.name,
                  }))}
                  onChange={(nextValue) =>
                    setUtilityAssistantRefs((current) => ({
                      ...current,
                      contextCompressionAssistantId: nextValue,
                    }))
                  }
                />
              </div>
            </section>

            <section
              className="summary-framework-panel"
              aria-label="上下文总结框架"
            >
              <header>
                <div>
                  <p className="eyebrow">Context summary framework</p>
                  <h3>上下文总结框架</h3>
                </div>
                <button type="button" onClick={resetContextSummaryFramework}>
                  还原全部默认描述
                </button>
              </header>
              <p className="summary-framework-note">
                五个维度是固定基向量；这里只允许覆盖系统描述，用于引导总结助手正确分类。
              </p>
              <div className="summary-framework-grid">
                {contextSummaryFramework.sections.map((section) => {
                  const defaultSection =
                    defaultContextSummaryFramework.sections.find(
                      (candidate) => candidate.id === section.id,
                    );
                  const isDefaultInstruction =
                    section.instruction === defaultSection?.instruction;

                  return (
                    <article
                      className="summary-framework-card"
                      key={section.id}
                    >
                      <div className="summary-framework-card-header">
                        <div>
                          <h4>{section.title}</h4>
                          <span>
                            {section.required ? "必填维度" : "按需填写"}
                          </span>
                        </div>
                        <button
                          type="button"
                          aria-label={`还原${section.title}默认描述`}
                          disabled={isDefaultInstruction}
                          onClick={() =>
                            resetContextSummaryFrameworkInstruction(section.id)
                          }
                        >
                          还原默认
                        </button>
                      </div>
                      <label>
                        <span>系统描述</span>
                        <textarea
                          aria-label={`${section.title}系统描述`}
                          rows={3}
                          value={section.instruction}
                          onChange={(event) =>
                            updateContextSummaryFrameworkInstruction(
                              section.id,
                              event.target.value,
                            )
                          }
                        />
                      </label>
                    </article>
                  );
                })}
              </div>
            </section>

            <section
              className="summary-framework-panel"
              aria-label="上下文配置"
            >
              <header>
                <div>
                  <p className="eyebrow">Context config</p>
                  <h3>上下文配置</h3>
                </div>
                <div className="header-actions">
                  <button type="button" onClick={createContextProfile}>
                    <Plus size={16} />
                    新增上下文配置
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() =>
                      deleteContextProfile(editingContextProfile.id)
                    }
                  >
                    <Trash2 size={16} />
                    删除配置
                  </button>
                </div>
              </header>
              <p className="summary-framework-note">
                聊天助手引用这里的上下文配置；全局总结助手会按当前聊天助手绑定的配置执行总结，不需要为每个聊天助手单独配置总结助手。
              </p>
              <div className="profile-layout">
                <aside className="profile-directory">
                  <div className="assistant-config-select">
                    <span>当前配置</span>
                    <CustomSelect
                      label="选择上下文配置"
                      value={editingContextProfile.id}
                      options={contextProfiles.map((profile) => ({
                        value: profile.id,
                        label: profile.name,
                      }))}
                      onChange={setEditingContextProfileId}
                    />
                  </div>
                  <div className="assistant-card-list">
                    {contextProfiles.map((profile, index) => (
                      <div className="sortable-card-row" key={profile.id}>
                        <button
                          className={`assistant-card ${
                            profile.id === editingContextProfile.id
                              ? "selected"
                              : ""
                          }`}
                          type="button"
                          onClick={() => setEditingContextProfileId(profile.id)}
                        >
                          <span>{profile.name}</span>
                          <small>
                            {profile.dimensionOverrides.length} 个维度重载
                          </small>
                        </button>
                        <ReorderControls
                          itemName={`上下文配置 ${profile.name}`}
                          isFirst={index === 0}
                          isLast={index === contextProfiles.length - 1}
                          onMoveUp={() => moveContextProfile(profile.id, -1)}
                          onMoveDown={() => moveContextProfile(profile.id, 1)}
                        />
                      </div>
                    ))}
                  </div>
                </aside>

                <section className="profile-detail">
                  <div className="reflected-fields">
                    <label className="detail-field">
                      <span>配置名称</span>
                      <input
                        aria-label="上下文配置名称"
                        value={editingContextProfile.name}
                        onChange={(event) =>
                          updateContextProfileField(
                            editingContextProfile.id,
                            "name",
                            event.target.value,
                          )
                        }
                      />
                    </label>
                    <label className="detail-field">
                      <span>配置描述</span>
                      <input
                        aria-label="上下文配置描述"
                        value={editingContextProfile.description}
                        onChange={(event) =>
                          updateContextProfileField(
                            editingContextProfile.id,
                            "description",
                            event.target.value,
                          )
                        }
                      />
                    </label>
                  </div>

                  <div className="summary-framework-grid">
                    {contextSummaryFramework.sections.map((section) => {
                      const override = getContextProfileOverride(
                        editingContextProfile,
                        section.id,
                      );
                      const enabled = isContextProfileDimensionEnabled(
                        editingContextProfile,
                        section.id,
                      );
                      const value = override?.instruction ?? "";

                      return (
                        <article
                          className={`summary-framework-card ${
                            enabled ? "" : "disabled"
                          }`}
                          key={section.id}
                        >
                          <div className="summary-framework-card-header">
                            <div>
                              <h4>{section.title}</h4>
                              <span>{section.id}</span>
                            </div>
                            <div className="dimension-actions">
                              <label className="dimension-toggle">
                                <input
                                  aria-label={`启用${section.title}上下文维度`}
                                  checked={enabled}
                                  type="checkbox"
                                  onChange={(event) =>
                                    toggleContextProfileDimension(
                                      editingContextProfile.id,
                                      section.id,
                                      event.target.checked,
                                    )
                                  }
                                />
                                <span>启用</span>
                              </label>
                              <button
                                type="button"
                                disabled={!enabled || !value.trim()}
                                onClick={() =>
                                  clearContextProfileOverride(
                                    editingContextProfile.id,
                                    section.id,
                                  )
                                }
                              >
                                清空重载
                              </button>
                            </div>
                          </div>
                          <p className="summary-framework-note">
                            {enabled
                              ? `默认：${section.instruction}`
                              : `未启用：该维度不会进入普通聊天或总结提示；当前重载内容仅保留为预览。默认：${section.instruction}`}
                          </p>
                          <label>
                            <span>配置重载说明</span>
                            <textarea
                              aria-label={`${section.title}上下文重载说明`}
                              disabled={!enabled}
                              rows={3}
                              placeholder="留空则完全使用系统描述；填写时只补充该业务/玩法/角色场景的额外分类规则。"
                              value={value}
                              onChange={(event) =>
                                updateContextProfileOverride(
                                  editingContextProfile.id,
                                  section.id,
                                  event.target.value,
                                )
                              }
                            />
                          </label>
                        </article>
                      );
                    })}
                  </div>

                  <div className="header-actions">
                    <button
                      type="button"
                      onClick={() =>
                        resetContextProfile(editingContextProfile.id)
                      }
                    >
                      还原当前配置重载
                    </button>
                  </div>
                </section>
              </div>
            </section>

            <section className="backup-panel" aria-label="备份与存储">
              <header>
                <div>
                  <p className="eyebrow">Storage</p>
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

            <section className="api-profile-panel" aria-label="连接与模型">
              <header>
                <div>
                  <p className="eyebrow">Connections</p>
                  <h3>连接与模型</h3>
                </div>
                <button type="button" onClick={createApiProfile}>
                  <Plus size={16} />
                  新增连接
                </button>
              </header>

              <div className="profile-layout">
                <aside className="profile-directory">
                  <div className="assistant-config-select">
                    <span>当前连接</span>
                    <CustomSelect
                      label="选择连接"
                      value={editingApiProfile?.id ?? ""}
                      options={apiProfiles.map((profile) => ({
                        value: profile.id,
                        label: profile.name,
                      }))}
                      onChange={(nextValue) => {
                        const profile = apiProfiles.find(
                          (candidate) => candidate.id === nextValue,
                        );
                        setEditingApiProfileId(nextValue);
                        setEditingModelId(profile?.models[0]?.id ?? "");
                      }}
                    />
                  </div>
                  <div className="assistant-card-list">
                    {apiProfiles.map((profile, index) => (
                      <div className="sortable-card-row" key={profile.id}>
                        <button
                          className={`assistant-card ${
                            profile.id === editingApiProfile?.id
                              ? "selected"
                              : ""
                          }`}
                          type="button"
                          onClick={() => {
                            setEditingApiProfileId(profile.id);
                            setEditingModelId(profile.models[0]?.id ?? "");
                          }}
                        >
                          <span>{profile.name}</span>
                          <small>{profile.models.length} models</small>
                        </button>
                        <ReorderControls
                          itemName={`连接 ${profile.name}`}
                          isFirst={index === 0}
                          isLast={index === apiProfiles.length - 1}
                          onMoveUp={() => moveApiProfile(profile.id, -1)}
                          onMoveDown={() => moveApiProfile(profile.id, 1)}
                        />
                      </div>
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
                        <span>连接名称</span>
                        <input
                          aria-label="连接名称"
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
                      <div className="detail-field">
                        <span>协议</span>
                        <CustomSelect
                          label="协议"
                          value={editingApiProfile.protocol}
                          options={[
                            {
                              value: "openai-responses",
                              label: "OpenAI-compatible Responses",
                            },
                            {
                              value: "openai-chat-completions",
                              label: "OpenAI-compatible Chat Completions",
                            },
                          ]}
                          onChange={(nextValue) =>
                            updateApiProfileField(
                              editingApiProfile.id,
                              "protocol",
                              nextValue as ApiProtocol,
                            )
                          }
                        />
                      </div>
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
                        <div className="secret-field">
                          <input
                            aria-label="API Key"
                            type={apiKeyVisible ? "text" : "password"}
                            value={editingApiProfile.apiKey}
                            onChange={(event) =>
                              updateApiProfileField(
                                editingApiProfile.id,
                                "apiKey",
                                event.target.value,
                              )
                            }
                          />
                          <button
                            type="button"
                            aria-label={apiKeyVisible ? "隐藏密钥" : "显示密钥"}
                            onClick={() =>
                              setApiKeyVisible((visible) => !visible)
                            }
                          >
                            {apiKeyVisible ? (
                              <EyeOff size={16} />
                            ) : (
                              <Eye size={16} />
                            )}
                          </button>
                        </div>
                      </label>
                      <label className="detail-field checkbox-field">
                        <span>启用连接</span>
                        <input
                          aria-label="启用连接"
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
                        <span>连接描述</span>
                        <textarea
                          aria-label="连接描述"
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
                      <div className="detail-field danger-zone">
                        <span>连接操作</span>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => deleteApiProfile(editingApiProfile.id)}
                        >
                          <Trash2 size={16} />
                          删除当前连接
                        </button>
                        <small>
                          会删除该连接下的模型配置，并移除引用这些模型的助手绑定；历史消息保留原始快照。
                        </small>
                      </div>
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

                    <div className="assistant-config-select">
                      <span>当前模型</span>
                      <CustomSelect
                        label="选择模型配置"
                        value={editingModel?.id ?? ""}
                        options={editingApiProfile.models.map((model) => ({
                          value: model.id,
                          label: model.name,
                        }))}
                        onChange={setEditingModelId}
                      />
                    </div>

                    <div className="model-card-list" aria-label="模型配置列表">
                      {editingApiProfile.models.map((model, index) => (
                        <div className="sortable-card-row" key={model.id}>
                          <button
                            className={`model-card ${
                              model.id === editingModel?.id ? "selected" : ""
                            }`}
                            type="button"
                            aria-label={`编辑模型 ${model.name}`}
                            onClick={() => setEditingModelId(model.id)}
                          >
                            <span>{model.name}</span>
                            <small>{model.id}</small>
                            <small>{model.enabled ? "已启用" : "已停用"}</small>
                          </button>
                          <ReorderControls
                            itemName={`模型 ${model.name}`}
                            isFirst={index === 0}
                            isLast={
                              index === editingApiProfile.models.length - 1
                            }
                            onMoveUp={() =>
                              moveModel(editingApiProfile.id, model.id, -1)
                            }
                            onMoveDown={() =>
                              moveModel(editingApiProfile.id, model.id, 1)
                            }
                          />
                        </div>
                      ))}
                    </div>

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
                        <div className="detail-field danger-zone">
                          <span>模型操作</span>
                          <button
                            className="danger-button"
                            type="button"
                            onClick={() =>
                              deleteModel(editingApiProfile.id, editingModel.id)
                            }
                          >
                            <Trash2 size={16} />
                            删除当前模型
                          </button>
                          <small>
                            仅删除当前连接下的模型配置和助手绑定；历史消息保留原始快照。
                          </small>
                        </div>
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

                <div className="assistant-config-select">
                  <span>当前编辑</span>
                  <CustomSelect
                    label="设置中选择助手"
                    value={editingAssistant.id}
                    options={assistants.map((assistant) => ({
                      value: assistant.id,
                      label: assistant.name,
                    }))}
                    onChange={setEditingAssistantId}
                  />
                </div>

                <div className="assistant-kind-groups">
                  {[
                    {
                      title: "聊天助手",
                      description: "用于前台对话，可绑定上下文配置。",
                      items: chatAssistants,
                    },
                    {
                      title: "功能助手",
                      description: "用于总结、压缩等内置语义任务。",
                      items: utilityAssistants,
                    },
                  ].map((section) => (
                    <section
                      className="assistant-kind-group"
                      aria-label={`${section.title}列表`}
                      key={section.title}
                    >
                      <header className="assistant-kind-header">
                        <div>
                          <span>{section.title}</span>
                          <small>{section.description}</small>
                        </div>
                        <strong>{section.items.length}</strong>
                      </header>
                      <div className="assistant-card-list">
                        {section.items.map((assistant, index) => {
                          const assistantModelStrategy =
                            getUtilityAssistantModelStrategy(assistant);
                          const assistantResolvedDefaultModel =
                            assistantModelStrategy === "fixed"
                              ? resolveAssistantDefaultModel(
                                  assistant,
                                  apiProfiles,
                                )
                              : undefined;
                          const assistantModelLabel =
                            assistant.kind === "utility" &&
                            assistantModelStrategy === "follow-conversation"
                              ? "跟随对话模型"
                              : assistantResolvedDefaultModel
                                ? assistantResolvedDefaultModel.model.name
                                : "未绑定模型";

                          return (
                            <div
                              className="sortable-card-row"
                              key={assistant.id}
                            >
                              <button
                                className={`assistant-card ${
                                  assistant.id === editingAssistant.id
                                    ? "selected"
                                    : ""
                                }`}
                                type="button"
                                onClick={() =>
                                  setEditingAssistantId(assistant.id)
                                }
                              >
                                <span>{assistant.name}</span>
                                <small>{assistantModelLabel}</small>
                              </button>
                              <ReorderControls
                                itemName={`${section.title} ${assistant.name}`}
                                isFirst={index === 0}
                                isLast={index === section.items.length - 1}
                                onMoveUp={() => moveAssistant(assistant.id, -1)}
                                onMoveDown={() =>
                                  moveAssistant(assistant.id, 1)
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              </aside>

              <section className="assistant-detail" aria-label="助手详情">
                <header>
                  <div>
                    <p className="eyebrow">Assistant details</p>
                    <h3>{editingAssistant.name}</h3>
                  </div>
                  <div className="header-actions">
                    <button
                      type="button"
                      disabled={editingAssistant.kind !== "chat"}
                      onClick={() => activateAssistant(editingAssistant.id)}
                    >
                      设为当前
                    </button>
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => deleteAssistant(editingAssistant.id)}
                    >
                      <Trash2 size={16} />
                      删除助手
                    </button>
                  </div>
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
                        <div className="detail-field" key={field.key}>
                          <span>{field.label}</span>
                          <CustomSelect
                            label={field.label}
                            value={String(value)}
                            options={
                              field.options?.map((option) => ({
                                value: option.value,
                                label: option.label,
                              })) ?? []
                            }
                            onChange={(nextValue) =>
                              updateAssistantField(
                                editingAssistant.id,
                                field.key,
                                nextValue,
                              )
                            }
                          />
                          {field.helper ? <small>{field.helper}</small> : null}
                        </div>
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

                {editingAssistant.kind === "chat" ? (
                  <section
                    className="model-bindings"
                    aria-label="助手上下文配置设置"
                  >
                    <header>
                      <div>
                        <p className="eyebrow">Context config</p>
                        <h3>助手上下文配置</h3>
                      </div>
                    </header>
                    <div className="assistant-config-select">
                      <span>当前助手使用的上下文配置</span>
                      <CustomSelect
                        label="助手上下文配置"
                        value={
                          resolveContextProfile(
                            contextProfiles,
                            editingAssistant.contextProfileId,
                          ).id
                        }
                        options={contextProfiles.map((profile) => ({
                          value: profile.id,
                          label: profile.name,
                        }))}
                        onChange={(nextValue) =>
                          updateAssistantContextProfile(
                            editingAssistant.id,
                            nextValue,
                          )
                        }
                      />
                      <small>
                        普通聊天会注入该上下文配置；主动总结时，全局总结助手也会按它执行分类。
                      </small>
                    </div>
                  </section>
                ) : null}

                {editingAssistant.kind === "utility" ? (
                  <section
                    className="model-bindings"
                    aria-label="功能助手模型策略"
                  >
                    <header>
                      <div>
                        <p className="eyebrow">Model strategy</p>
                        <h3>功能助手模型策略</h3>
                      </div>
                    </header>
                    <div className="assistant-config-select">
                      <span>模型策略</span>
                      <CustomSelect
                        label="功能助手模型策略"
                        value={editingAssistantModelStrategy}
                        options={[
                          {
                            value: "follow-conversation",
                            label: "跟随当前对话模型",
                          },
                          {
                            value: "fixed",
                            label: "指定模型",
                          },
                        ]}
                        onChange={(nextValue) =>
                          updateUtilityAssistantModelStrategy(
                            editingAssistant.id,
                            nextValue as UtilityAssistantModelStrategy,
                          )
                        }
                      />
                      <small>
                        跟随当前对话模型时，该功能助手不需要单独维护允许模型；指定模型后才启用下方模型配置。
                      </small>
                    </div>
                    <div className="assistant-config-select">
                      <span>当前执行模型</span>
                      <strong>
                        {editingAssistantModelStrategy === "fixed"
                          ? editingAssistantDefaultResolvedModel
                            ? `${editingAssistantDefaultResolvedModel.apiProfile.name} / ${editingAssistantDefaultResolvedModel.model.name}`
                            : "未指定可用模型"
                          : activeResolvedModel
                            ? `${activeResolvedModel.apiProfile.name} / ${activeResolvedModel.model.name}`
                            : "当前对话没有可用模型"}
                      </strong>
                    </div>
                  </section>
                ) : null}

                {editingAssistant.kind === "chat" ||
                editingAssistantModelStrategy === "fixed" ? (
                  <section className="model-bindings" aria-label="助手允许模型">
                    <header>
                      <div>
                        <p className="eyebrow">Model access</p>
                        <h3>助手允许模型</h3>
                      </div>
                    </header>
                    <div className="assistant-config-select">
                      <span>该助手默认模型</span>
                      <CustomSelect
                        label="该助手默认模型"
                        value={editingAssistantDefaultResolvedModel?.key ?? ""}
                        options={editingAssistantResolvedModelOptions.map(
                          (option) => ({
                            value: option.key,
                            label: `${option.apiProfile.name} / ${option.model.name}`,
                          }),
                        )}
                        disabled={
                          editingAssistantResolvedModelOptions.length === 0
                        }
                        onChange={(nextValue) =>
                          setAssistantDefaultModel(
                            editingAssistant.id,
                            nextValue,
                          )
                        }
                      />
                      <small>
                        默认模型只能从下方已勾选且仍可用的允许模型中选择。
                      </small>
                    </div>

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
                ) : null}
              </section>
            </section>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
