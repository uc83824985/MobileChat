import {
  Archive,
  ArrowUpToLine,
  Bot,
  Check,
  Database,
  Download,
  Eye,
  EyeOff,
  ImageIcon,
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
  TextQuote,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type ClipboardEvent,
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
  type ContextProfileWorkflowDraft,
  type ContextSummaryFramework,
  type ContextSummaryRecord,
  CONTEXT_SUMMARY_ASSISTANT_ID,
  createId,
  createInitialSnapshot,
  defaultContextProfile,
  defaultContextProfileWorkflowDraft,
  defaultContextSummaryFramework,
  defaultModelProbeSettings,
  DEFAULT_CONTEXT_PROFILE_SUMMARY_MAX_CHARS,
  DEFAULT_CONTEXT_SUMMARY_AUTO_MESSAGE_INTERVAL,
  DEFAULT_CONTEXT_SUMMARY_RAW_TAIL_MESSAGES,
  DEFAULT_MESSAGE_QUOTE_TEMPLATE,
  DEFAULT_MODEL_REF,
  defaultAssistant,
  type LocalBlobRecord,
  type LocalDataSnapshot,
  type LayoutMode,
  type Message,
  type MessageImagePart,
  type ModelDefinition,
  type ModelProbeDimensionValue,
  type ModelProbeGroup,
  type ModelProbeRule,
  type ModelProbeSettings,
  type ModelRef,
  modelRefKey,
  normalizeMessageQuoteTemplate,
  parseModelRefKey,
  type ResponseUsage,
  type SaveStatus,
  type StorageInfo,
  type ThemeMode,
  type UtilityAssistantModelStrategy,
} from "./domain";
import {
  createEmptyModelProbeGroup,
  expandModelProbeSettings,
  type ModelProbeResult,
  normalizeModelProbeSettings,
  runModelProbePool,
} from "./modelProbe";
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
type DraftImage = MessageImagePart & {
  previewUrl: string;
};
type ImagePreviewState = {
  src: string;
  label: string;
  name: string;
  size: number;
} | null;
type MessageTextSelection = {
  messageId: string;
  text: string;
} | null;
type StreamingTextChunks = Record<string, string[]>;

declare global {
  interface Window {
    MobileChatAndroid?: {
      saveArchive?: (fileName: string, base64Data: string) => string;
      setStatusBarHidden?: (enabled: boolean) => void;
    };
  }
}

const UI_PREFERENCES_STORAGE_KEY = "mobilechat:ui-preferences";
const AUTOSAVE_DELAY_MS = 400;
const SCROLL_EDGE_THRESHOLD_PX = 12;
const COMPOSER_MAX_HEIGHT_PX = 220;
const MOBILE_LAYOUT_MAX_WIDTH_PX = 820;
const PHONE_LANDSCAPE_DESKTOP_MIN_WIDTH_PX = 640;
const CONSTRAINED_VIEWPORT_MAX_WIDTH_PX = 920;
const CONSTRAINED_VIEWPORT_MAX_HEIGHT_PX = 560;
const PANEL_SWIPE_EDGE_GUARD_PX = 32;
const PANEL_SWIPE_TRIGGER_PX = 64;
const PANEL_SWIPE_VERTICAL_LIMIT_PX = 56;
const DIAGNOSTICS_SWIPE_TRIGGER_PX = 52;
const DIAGNOSTICS_SWIPE_HORIZONTAL_LIMIT_PX = 72;
const MODEL_PROBE_CONCURRENCY = 8;
const MAX_DRAFT_IMAGES = 4;
const MAX_DRAFT_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_INPUT_ACCEPT = "image/*";
const TTS_SPEAK_ENDPOINT = "http://127.0.0.1:8765/speak";
const TTS_SPEAK_MODE = "replace";
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

type ViewportProfile = {
  prefersMobileLayout: boolean;
  isConstrained: boolean;
  isLandscape: boolean;
  width: number;
  height: number;
};

const getViewportProfile = (): ViewportProfile => {
  if (typeof window === "undefined") {
    return {
      prefersMobileLayout: false,
      isConstrained: false,
      isLandscape: false,
      width: 1024,
      height: 768,
    };
  }

  const width = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const height = Math.round(
    window.visualViewport?.height ?? window.innerHeight,
  );
  const isPortrait =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(orientation: portrait)").matches
      : height >= width;
  const isLandscape = !isPortrait;
  const shouldUseDesktopInLandscape =
    isLandscape && width >= PHONE_LANDSCAPE_DESKTOP_MIN_WIDTH_PX;

  return {
    prefersMobileLayout:
      !shouldUseDesktopInLandscape &&
      (isPortrait || width <= MOBILE_LAYOUT_MAX_WIDTH_PX),
    isConstrained:
      width <= CONSTRAINED_VIEWPORT_MAX_WIDTH_PX ||
      height <= CONSTRAINED_VIEWPORT_MAX_HEIGHT_PX,
    isLandscape,
    width,
    height,
  };
};

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

const getMessageImageParts = (message: Message) => message.imageParts ?? [];

const hasMessageContent = (message: Message) =>
  Boolean(message.text.trim()) || getMessageImageParts(message).length > 0;

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const formatMessageImageMarker = (part: MessageImagePart) =>
  `[${part.referenceLabel ?? "图片"}：${part.name || "image"}，${
    part.mimeType || "image/*"
  }，${formatBytes(part.size)}]`;

const readImageReferenceNumber = (label?: string) => {
  const match = label?.match(/^图片(\d+)$/);
  return match ? Number(match[1]) : 0;
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("图片读取失败：FileReader 未返回 data URL。"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("图片读取失败。"));
    reader.readAsDataURL(file);
  });

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const createLooseSearchRegex = (query: string) => {
  const terms = query.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  return terms.length > 0 ? new RegExp(terms.join(".*"), "i") : undefined;
};

const createMessageSearchRegex = (query: string, regexEnabled: boolean) => {
  const trimmed = query.trim();
  if (!trimmed) {
    return { regex: undefined, error: "" };
  }

  try {
    return {
      regex: regexEnabled
        ? new RegExp(trimmed, "i")
        : createLooseSearchRegex(trimmed),
      error: "",
    };
  } catch (error) {
    return {
      regex: undefined,
      error: error instanceof Error ? error.message : "正则表达式无效",
    };
  }
};

const readBootUiPreferences = ():
  | {
      themeMode?: ThemeMode;
      layoutMode?: LayoutMode;
      hideMobileStatusBar?: boolean;
    }
  | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? "{}",
    ) as {
      themeMode?: unknown;
      layoutMode?: unknown;
      hideMobileStatusBar?: unknown;
    };
    return {
      themeMode: isThemeMode(parsed.themeMode) ? parsed.themeMode : undefined,
      layoutMode: isLayoutMode(parsed.layoutMode)
        ? parsed.layoutMode
        : undefined,
      hideMobileStatusBar:
        typeof parsed.hideMobileStatusBar === "boolean"
          ? parsed.hideMobileStatusBar
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
      hideMobileStatusBar:
        uiPreferences?.hideMobileStatusBar ??
        snapshot.settings.hideMobileStatusBar,
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
  models: [],
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
  summaryMaxChars: DEFAULT_CONTEXT_PROFILE_SUMMARY_MAX_CHARS,
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
  const widestOption = options.reduce<CustomSelectOption | undefined>(
    (current, option) =>
      !current || option.label.length > current.label.length ? option : current,
    undefined,
  );

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
      <span className="custom-select-sizer" aria-hidden="true">
        <span>{widestOption?.label ?? selectedOption?.label ?? "未选择"}</span>
        <span className="custom-select-chevron" />
      </span>
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

const normalizeQuotedText = (text: string) =>
  text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

const formatMessageQuote = (template: string, content: string) => {
  const normalizedContent = normalizeQuotedText(content);
  const normalizedTemplate = template.trim()
    ? template
    : DEFAULT_MESSAGE_QUOTE_TEMPLATE;

  if (normalizedTemplate.includes("{content}")) {
    return normalizedTemplate.replaceAll("{content}", normalizedContent);
  }

  return `${normalizedTemplate.replace(/\s+$/u, "")}\n${normalizedContent}`;
};

const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("当前浏览器不允许写入剪贴板。");
    }
  } finally {
    document.body.removeChild(textarea);
  }
};

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
  "enter-send": "Enter 发送",
  "ctrl-enter-send": "Enter 换行",
};

const normalizeContextSummaryRawTailMessages = (value: number) =>
  Number.isFinite(value)
    ? Math.max(0, Math.min(50, Math.trunc(value)))
    : DEFAULT_CONTEXT_SUMMARY_RAW_TAIL_MESSAGES;

const normalizeContextSummaryAutoMessageInterval = (value: number) =>
  Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.trunc(value)))
    : DEFAULT_CONTEXT_SUMMARY_AUTO_MESSAGE_INTERVAL;

const normalizeContextProfileSummaryMaxChars = (value: number) =>
  Number.isFinite(value)
    ? Math.max(500, Math.min(50000, Math.trunc(value)))
    : DEFAULT_CONTEXT_PROFILE_SUMMARY_MAX_CHARS;

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

const estimateTokenCount = (
  messages: Message[],
  draft = "",
  draftImageCount = 0,
) => {
  const textLength =
    messages.reduce((sum, message) => sum + message.text.length, 0) +
    draft.length;
  const imageCount =
    messages.reduce(
      (sum, message) => sum + getMessageImageParts(message).length,
      0,
    ) + draftImageCount;
  return Math.max(1, Math.ceil(textLength / 2) + imageCount * 800);
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
  const imageText = getMessageImageParts(message)
    .map(formatMessageImageMarker)
    .join("\n");
  const messageText = [message.text.trim(), imageText]
    .filter(Boolean)
    .join("\n");

  return `#${index + 1} ${roleLabel}${source}${time ? ` · ${time}` : ""}\n${
    messageText || "[空消息]"
  }`;
};

const formatMessageSearchText = (message: Message) =>
  [message.text, ...getMessageImageParts(message).map(formatMessageImageMarker)]
    .filter(Boolean)
    .join("\n");

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

const formatBlankable = (value: string | undefined, fallback = "未填写") =>
  value?.trim() ? value.trim() : fallback;

const formatContextProfileWorkflowDimensions = (
  framework: ContextSummaryFramework,
  profile: ContextProfile,
) =>
  framework.sections
    .map((section) => {
      const override = getContextProfileOverride(profile, section.id);
      const enabled = isContextProfileDimensionEnabled(profile, section.id);
      return [
        `### ${section.title}`,
        `- dimensionId: ${section.id}`,
        `- 当前启用：${enabled ? "是" : "否"}`,
        `- 系统说明：${section.instruction}`,
        `- 当前重载：${formatBlankable(override?.instruction)}`,
      ].join("\n");
    })
    .join("\n\n");

type ContextProfileWorkflowPromptMode = "start" | "export";

const buildContextProfileWorkflowPrompt = ({
  mode,
  framework,
  profile,
  assistant,
}: {
  mode: ContextProfileWorkflowPromptMode;
  framework: ContextSummaryFramework;
  profile: ContextProfile;
  assistant: Assistant;
}) => {
  const frameworkDefinitions = framework.sections
    .map(
      (section) => `- ${section.title} (${section.id})：${section.instruction}`,
    )
    .join("\n");

  const assistantReference = [
    `- 名称：${assistant.name}`,
    `- 类型：${assistant.kind}`,
    `- 描述：${formatBlankable(assistant.description)}`,
    `- Prompt：${formatBlankable(assistant.prompt)}`,
    `- 初始消息：${formatBlankable(assistant.initialMessage)}`,
  ].join("\n");

  if (mode === "start") {
    return `# MobileChat 上下文配置讨论起始说明

你是 MobileChat 的上下文配置设计助手。本次对话目标是：和用户一起讨论并设计一份“用于特定用途的新上下文配置”。

MobileChat 只支持单对话内记忆；上下文配置用于指导普通聊天请求和上下文总结助手如何保留信息。请先用自然语言讨论，不要直接导出 JSON。等用户提供“导出说明”后，再输出可被 MobileChat 解析的最终配置。

## 固定五维定义

${frameworkDefinitions}

## 当前聊天助手参考

${assistantReference}

## 讨论方式

这是一个收敛式配置访谈，不是头脑风暴菜单。请避免一次性列出大量备选项、完整模板、玩法菜单或“如果你想 A/B/C/D”的分支。

请按下面规则推进：
- 如果用户已经给出用途，先给一个“推荐方向”，不要同时给多套方案。
- 每轮最多追问 3 个关键问题；如果问题不影响首版配置，可以先不问。
- 如果必须给备选，最多 3 个，并明确推荐其中 1 个。
- 不要主动展开长清单、角色卡模板、流程菜单、快速路径合集；除非用户明确要求“多给几个选项”。
- 讨论阶段只输出自然语言判断和待确认点，不输出最终 JSON。
- 当用户确认方案后，等待用户粘贴“导出说明”再生成标准输出。

推荐回复结构：
1. 当前判断：用 2-4 句概括你对用途和记忆边界的理解。
2. 推荐配置方向：按五维度给非常短的草案，每维不超过 1 句；不确定的维度写“暂不强化”。
3. 需要确认：只列 1-3 个会明显影响配置的问题。
`;
  }

  return `# MobileChat 上下文配置导出说明

你是 MobileChat 的上下文配置设计助手。请基于本次对话里已经讨论出的用途、规范、应用场景和助手职责，导出一份可被 MobileChat 直接解析的新上下文配置。

MobileChat 只支持单对话内记忆；上下文配置用于指导普通聊天请求和上下文总结助手如何保留信息。

## 固定五维框架

${frameworkDefinitions}

## 当前聊天助手

${assistantReference}

## 当前上下文配置参考

- 名称：${profile.name}
- 描述：${formatBlankable(profile.description)}
- summaryMaxChars：${normalizeContextProfileSummaryMaxChars(profile.summaryMaxChars)}

${formatContextProfileWorkflowDimensions(framework, profile)}

## 输出格式

先用很短的「设计说明」解释取舍，然后必须输出一个 \`json\` 代码块。JSON 只允许下面这些字段，不要新增维度 ID：

\`\`\`json
{
  "name": "配置名称",
  "description": "配置描述",
  "summaryMaxChars": 6000,
  "dimensions": {
    "strict_memory": { "enabled": true, "instruction": "" },
    "precise_facts": { "enabled": true, "instruction": "" },
    "fuzzy_memory": { "enabled": true, "instruction": "" },
    "exploration_log": { "enabled": true, "instruction": "" },
    "current_state": { "enabled": true, "instruction": "" }
  }
}
\`\`\`

约束：
- instruction 是写给总结助手和聊天助手看的配置说明，不是用户正文。
- 只写当前业务/玩法/助手场景需要补充的分类规则；能沿用系统说明的维度可留空。
- 如果某个维度对该场景没有价值，可以 enabled=false。
- summaryMaxChars 应按场景预算建议：简单工具助手偏短，角色扮演、世界状态、长期项目可更长。
- 输出应能直接粘贴回 MobileChat 的「配置解析区」并解析生成新上下文配置。
`;
};

type ParsedContextProfileWorkflowOutput = Pick<
  ContextProfile,
  "name" | "description" | "summaryMaxChars" | "dimensionOverrides"
>;

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readWorkflowString = (value: unknown) =>
  typeof value === "string" ? value : "";

const extractBalancedJsonObject = (text: string): string | undefined => {
  const start = text.indexOf("{");
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return undefined;
};

const extractContextProfileWorkflowJson = (text: string) => {
  const fencedBlocks = Array.from(
    text.matchAll(/```(?:json)?\s*([\s\S]*?)```/giu),
  ).map((match) => match[1]?.trim() ?? "");

  for (const block of fencedBlocks) {
    if (!block) {
      continue;
    }
    try {
      JSON.parse(block);
      return block;
    } catch {
      // Try the next fenced block.
    }
  }

  const trimmed = text.trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    return extractBalancedJsonObject(trimmed);
  }
};

const parseContextProfileWorkflowOutput = (
  text: string,
  framework: ContextSummaryFramework,
): ParsedContextProfileWorkflowOutput => {
  const jsonText = extractContextProfileWorkflowJson(text);
  if (!jsonText) {
    throw new Error("未找到可解析的 JSON 配置块。");
  }

  const parsed = JSON.parse(jsonText) as unknown;
  if (!isUnknownRecord(parsed)) {
    throw new Error("JSON 顶层必须是对象。");
  }

  const dimensions = isUnknownRecord(parsed.dimensions)
    ? parsed.dimensions
    : {};
  const dimensionOverrides = framework.sections.flatMap((section) => {
    const dimension = dimensions[section.id];
    if (!isUnknownRecord(dimension)) {
      return [];
    }

    const enabled =
      typeof dimension.enabled === "boolean" ? dimension.enabled : true;
    const instruction = readWorkflowString(dimension.instruction);

    if (enabled && !instruction.trim()) {
      return [];
    }

    return [
      {
        dimensionId: section.id,
        enabled,
        instruction,
      },
    ];
  });

  return {
    name: readWorkflowString(parsed.name).trim() || "Agent 生成上下文配置",
    description: readWorkflowString(parsed.description),
    summaryMaxChars: normalizeContextProfileSummaryMaxChars(
      Number(parsed.summaryMaxChars),
    ),
    dimensionOverrides,
  };
};

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
  maxChars,
}: {
  conversation: Conversation;
  previousSummary?: string;
  messages: Message[];
  framework: ContextSummaryFramework;
  contextProfile: ContextProfile;
  maxChars: number;
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
- 如果已有旧总结，请把新增消息合并进去，输出一份完整的新总结；不要在旧总结后追加流水账。
- 总结预算来自当前聊天助手绑定的上下文配置：输出必须不超过 ${maxChars} 个字符。超限会被本地拒绝。
- 若信息过多，请优先保留“严格记忆、精确事实、当前状态”，合并“探索记录”，压缩或删除低价值“模糊记忆”和过期过程。
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

const buildContextSummaryRewritePrompt = ({
  summary,
  maxChars,
  framework,
  contextProfile,
}: {
  summary: string;
  maxChars: number;
  framework: ContextSummaryFramework;
  contextProfile: ContextProfile;
}) => `请把下面的 MobileChat 上下文总结改写为不超过 ${maxChars} 个字符的中文 Markdown。

要求：
- 这是对既有总结的预算修正，不是新聊天回复。
- 不要新增事实。
- 保持总结框架和当前上下文配置的分类意图。
- 优先保留严格记忆、精确事实、当前状态；合并探索记录；压缩或删除低价值模糊记忆和过期过程。
- 输出必须不超过 ${maxChars} 个字符，超限会被本地拒绝。

总结框架：
${formatContextSummaryFramework({
  ...framework,
  sections: createEffectiveContextSummarySections(framework, contextProfile),
})}

当前上下文配置：
${formatContextProfile(framework, contextProfile) || "当前上下文配置未启用任何上下文维度。"}

待改写总结：
${summary}`;

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

const parseModelIdListText = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);

const formatModelIdListText = (models: string[]) => models.join(", ");

const isMinorTenthsDimension = (
  value: ModelProbeDimensionValue,
): value is Extract<ModelProbeDimensionValue, { type: "minorTenths" }> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  "type" in value &&
  value.type === "minorTenths";

const flattenProbeDimensionValues = (
  value: ModelProbeDimensionValue,
): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(flattenProbeDimensionValues);
  }
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "values" in value
  ) {
    return value.values.flatMap(flattenProbeDimensionValues);
  }
  return [String(value ?? "")];
};

const formatProbeDimensionLabel = (key: string) =>
  key === "version"
    ? "版本区间"
    : key.startsWith("arg")
      ? `后缀段${key.slice(3) || ""}`
      : "后缀段";

const getNextProbeArgKey = (rule: ModelProbeRule) => {
  let index = 1;
  while (rule.dimensions[`arg${index}`] !== undefined) {
    index += 1;
  }
  return `arg${index}`;
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
  const [blobs, setBlobs] = useState<LocalBlobRecord[]>(bootSnapshot.blobs);
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
  const [hideMobileStatusBar, setHideMobileStatusBar] = useState(
    bootSnapshot.settings.hideMobileStatusBar,
  );
  const [viewportProfile, setViewportProfile] = useState(getViewportProfile);
  const [streamingEnabled, setStreamingEnabled] = useState(
    bootSnapshot.settings.streamingEnabled,
  );
  const [composerSubmitMode, setComposerSubmitMode] =
    useState<ComposerSubmitMode>(bootSnapshot.settings.composerSubmitMode);
  const [messageQuoteTemplate, setMessageQuoteTemplate] = useState(
    normalizeMessageQuoteTemplate(bootSnapshot.settings.messageQuoteTemplate),
  );
  const [contextSummaryRawTailMessages, setContextSummaryRawTailMessages] =
    useState(bootSnapshot.settings.contextSummaryRawTailMessages);
  const [
    contextSummaryAutoMessageInterval,
    setContextSummaryAutoMessageInterval,
  ] = useState(bootSnapshot.settings.contextSummaryAutoMessageInterval);
  const [utilityAssistantRefs, setUtilityAssistantRefs] = useState(
    bootSnapshot.settings.utilityAssistantRefs,
  );
  const [modelProbeSettings, setModelProbeSettings] =
    useState<ModelProbeSettings>(bootSnapshot.settings.modelProbeSettings);
  const [contextSummaryFramework, setContextSummaryFramework] = useState(
    bootSnapshot.settings.contextSummaryFramework,
  );
  const [contextProfiles, setContextProfiles] = useState<ContextProfile[]>(
    bootSnapshot.settings.contextProfiles,
  );
  const [contextProfileWorkflowDraft, setContextProfileWorkflowDraft] =
    useState<ContextProfileWorkflowDraft>(
      bootSnapshot.settings.contextProfileWorkflowDraft,
    );
  const [editingContextProfileId, setEditingContextProfileId] = useState(
    bootSnapshot.settings.editingContextProfileId,
  );
  const [nextTurnWebSearchEnabled, setNextTurnWebSearchEnabled] =
    useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dataInspectorOpen, setDataInspectorOpen] = useState(false);
  const [debugEnabled, setDebugEnabled] = useState(
    bootSnapshot.settings.debugEnabled,
  );
  const [draft, setDraft] = useState("");
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [composerNotice, setComposerNotice] = useState("");
  const [imagePreview, setImagePreview] = useState<ImagePreviewState>(null);
  const [selectedMessageText, setSelectedMessageText] =
    useState<MessageTextSelection>(null);
  const [streamingTextChunks, setStreamingTextChunks] =
    useState<StreamingTextChunks>({});
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [isMessageThreadAwayFromBottom, setIsMessageThreadAwayFromBottom] =
    useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationSearchRegexEnabled, setConversationSearchRegexEnabled] =
    useState(false);
  const [messageSearchQuery, setMessageSearchQuery] = useState("");
  const [messageSearchRegexEnabled, setMessageSearchRegexEnabled] =
    useState(false);
  const [activeMessageSearchIndex, setActiveMessageSearchIndex] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [editingTitleConversationId, setEditingTitleConversationId] = useState<
    string | null
  >(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [, setSaveStatus] = useState<SaveStatus>("loading");
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
  const [contextProfileWorkflowStatus, setContextProfileWorkflowStatus] =
    useState("");
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
  const [modelProbeRunning, setModelProbeRunning] = useState(false);
  const [modelProbeStatus, setModelProbeStatus] = useState("");
  const [modelProbeResults, setModelProbeResults] = useState<
    ModelProbeResult[]
  >([]);
  const [modelProbeGroupIdDraft, setModelProbeGroupIdDraft] = useState(
    bootSnapshot.settings.modelProbeSettings.editingGroupId,
  );
  const abortControllerRef = useRef<AbortController | null>(null);
  const ttsAbortControllerRef = useRef<AbortController | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const latestSnapshotRef = useRef<LocalDataSnapshot>(bootSnapshot);
  const contextSummaryJobRunningRef = useRef(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const messageThreadRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldFollowMessageBottomRef = useRef(true);
  const userThreadScrollIntentRef = useRef(false);
  const scrollFollowFrameRef = useRef<number | null>(null);
  const streamingFullTextRef = useRef<Record<string, string>>({});
  const drawerSwipeRef = useRef<{
    mode: "open-panel" | "close-drawer" | "close-settings";
    startX: number;
    startY: number;
  } | null>(null);
  const diagnosticsSwipeRef = useRef<{
    mode: "expand" | "collapse";
    startX: number;
    startY: number;
    bodyScrollTop: number;
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
  }, [draft, draftImages.length, resizeComposerInput, viewportProfile]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const updateViewportMode = () => {
      setViewportProfile(getViewportProfile());
    };
    const scheduleViewportModeUpdate = () => {
      updateViewportMode();
      window.requestAnimationFrame(updateViewportMode);
      window.setTimeout(updateViewportMode, 120);
      window.setTimeout(updateViewportMode, 360);
    };

    scheduleViewportModeUpdate();
    window.addEventListener("resize", scheduleViewportModeUpdate);
    window.addEventListener("orientationchange", scheduleViewportModeUpdate);
    window.visualViewport?.addEventListener(
      "resize",
      scheduleViewportModeUpdate,
    );

    return () => {
      window.removeEventListener("resize", scheduleViewportModeUpdate);
      window.removeEventListener(
        "orientationchange",
        scheduleViewportModeUpdate,
      );
      window.visualViewport?.removeEventListener(
        "resize",
        scheduleViewportModeUpdate,
      );
    };
  }, []);

  useEffect(() => {
    if (!debugEnabled) {
      setDataInspectorOpen(false);
      setMobileDiagnosticsExpanded(false);
    }
  }, [debugEnabled]);

  const scrollMessageThreadToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const thread = messageThreadRef.current;
      thread?.scrollTo?.({ top: thread.scrollHeight, behavior });
      if (document.body.scrollHeight > window.innerHeight) {
        window.scrollTo?.({
          top: document.body.scrollHeight,
          behavior,
        });
      }
      setIsMessageThreadAwayFromBottom(false);
    },
    [],
  );

  const scheduleScrollMessageThreadToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      if (scrollFollowFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFollowFrameRef.current);
      }

      scrollFollowFrameRef.current = window.requestAnimationFrame(() => {
        scrollFollowFrameRef.current = null;
        scrollMessageThreadToBottom(behavior);
      });
    },
    [scrollMessageThreadToBottom],
  );

  const startFollowingMessageBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      shouldFollowMessageBottomRef.current = true;
      userThreadScrollIntentRef.current = false;
      scheduleScrollMessageThreadToBottom(behavior);
    },
    [scheduleScrollMessageThreadToBottom],
  );

  const updateMessageThreadScrollState = useCallback(() => {
    const thread = messageThreadRef.current;
    const threadMaxScrollTop = thread
      ? thread.scrollHeight - thread.clientHeight
      : 0;
    const threadScrollable = threadMaxScrollTop > SCROLL_EDGE_THRESHOLD_PX;

    if (threadScrollable && thread) {
      const awayFromBottom =
        thread.scrollTop < threadMaxScrollTop - SCROLL_EDGE_THRESHOLD_PX;
      setIsMessageThreadAwayFromBottom(awayFromBottom);
      if (!awayFromBottom) {
        shouldFollowMessageBottomRef.current = true;
        userThreadScrollIntentRef.current = false;
        return;
      }
      if (pendingMessageId && userThreadScrollIntentRef.current) {
        shouldFollowMessageBottomRef.current = false;
      }
      return;
    }

    const scrollElement = document.scrollingElement ?? document.documentElement;
    const pageMaxScrollTop = scrollElement.scrollHeight - window.innerHeight;
    const pageScrollable = pageMaxScrollTop > SCROLL_EDGE_THRESHOLD_PX;

    if (pageScrollable) {
      const awayFromBottom =
        window.scrollY < pageMaxScrollTop - SCROLL_EDGE_THRESHOLD_PX;
      setIsMessageThreadAwayFromBottom(awayFromBottom);
      if (!awayFromBottom) {
        shouldFollowMessageBottomRef.current = true;
        userThreadScrollIntentRef.current = false;
        return;
      }
      if (pendingMessageId && userThreadScrollIntentRef.current) {
        shouldFollowMessageBottomRef.current = false;
      }
      return;
    }

    setIsMessageThreadAwayFromBottom(false);
    shouldFollowMessageBottomRef.current = true;
    userThreadScrollIntentRef.current = false;
  }, [pendingMessageId]);

  const markManualMessageThreadScrollIntent = useCallback(() => {
    userThreadScrollIntentRef.current = true;
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
  const messageSearch = useMemo(() => {
    const { regex, error } = createMessageSearchRegex(
      messageSearchQuery,
      messageSearchRegexEnabled,
    );
    const matches = regex
      ? activeMessages.filter((message) =>
          regex.test(formatMessageSearchText(message)),
        )
      : [];

    return {
      error,
      matches,
      ids: matches.map((message) => message.id),
    };
  }, [activeMessages, messageSearchQuery, messageSearchRegexEnabled]);
  const activeMessageSearchId =
    messageSearch.ids.length > 0
      ? messageSearch.ids[
          Math.min(activeMessageSearchIndex, messageSearch.ids.length - 1)
        ]
      : undefined;
  useEffect(() => {
    setActiveMessageSearchIndex(0);
  }, [activeConversation?.id, messageSearchQuery, messageSearchRegexEnabled]);

  useEffect(() => {
    if (activeMessageSearchIndex < messageSearch.ids.length) {
      return;
    }

    setActiveMessageSearchIndex(
      messageSearch.ids.length > 0 ? messageSearch.ids.length - 1 : 0,
    );
  }, [activeMessageSearchIndex, messageSearch.ids.length]);

  useEffect(() => {
    if (!activeMessageSearchId) {
      return;
    }

    const thread = messageThreadRef.current;
    const target = Array.from(
      thread?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [],
    ).find((element) => element.dataset.messageId === activeMessageSearchId);

    target?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [activeMessageSearchId]);
  const blobMap = useMemo(
    () => new Map(blobs.map((blob) => [blob.id, blob])),
    [blobs],
  );
  const imageCacheStats = useMemo(
    () => ({
      count: blobs.filter((blob) => blob.kind === "image").length,
      bytes: blobs.reduce((sum, blob) => sum + blob.size, 0),
    }),
    [blobs],
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
  const conversationSearchResult = useMemo(
    () =>
      createMessageSearchRegex(
        conversationSearch,
        conversationSearchRegexEnabled,
      ),
    [conversationSearch, conversationSearchRegexEnabled],
  );
  const visibleConversations = useMemo(() => {
    const source = showArchived ? archivedConversations : activeConversations;
    const regex = conversationSearchResult.regex;

    return source.filter((conversation) => {
      if (!regex) {
        return true;
      }

      return regex.test(`${conversation.title}\n${conversation.summary}`);
    });
  }, [
    activeConversations,
    archivedConversations,
    conversationSearchResult.regex,
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
      imageBlobs: imageCacheStats.count,
      imageBlobBytes: imageCacheStats.bytes,
      rawTailMessages: contextSummaryRawTailMessages,
      autoSummaryInterval: contextSummaryAutoMessageInterval,
      activeSummaryMaxChars: normalizeContextProfileSummaryMaxChars(
        activeContextProfile.summaryMaxChars,
      ),
    }),
    [
      activeConversations.length,
      activeContextProfile.summaryMaxChars,
      apiProfiles,
      archivedConversations.length,
      assistants,
      contextProfiles.length,
      contextSummaryAutoMessageInterval,
      contextSummaryRawTailMessages,
      conversations,
      imageCacheStats.bytes,
      imageCacheStats.count,
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
            summaryMaxChars:
              activeContextSummary.contextProfileSummaryMaxCharsSnapshot ??
              null,
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
  const editingModelProbeGroup = useMemo(
    () =>
      modelProbeSettings.groups.find(
        (group) => group.id === modelProbeSettings.editingGroupId,
      ) ??
      modelProbeSettings.groups[0] ??
      normalizeModelProbeSettings().groups[0],
    [modelProbeSettings.editingGroupId, modelProbeSettings.groups],
  );
  const modelProbeSelectedApiProfile = editingApiProfile ?? null;
  const modelProbeCandidates = useMemo(
    () =>
      editingModelProbeGroup
        ? expandModelProbeSettings(
            modelProbeSettings,
            editingModelProbeGroup.id,
          )
        : [],
    [editingModelProbeGroup, modelProbeSettings],
  );
  const modelProbeSuccessResults = useMemo(
    () => modelProbeResults.filter((result) => result.ok),
    [modelProbeResults],
  );
  const diagnostics = useMemo(
    () => [
      [
        "输入估算",
        `${estimateTokenCount(
          activeProjectedMessages,
          activeContextInstruction
            ? `${activeContextInstruction}\n${draft}`
            : draft,
          draftImages.length,
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
        } · ${draftImages.length > 0 ? `${draftImages.length} 图` : "仅文本"}`,
      ],
      ["发送后 usage", formatObservedUsage(lastObservedUsage)],
    ],
    [
      activeProjectedMessages,
      activeContextInstruction,
      activeResolvedModel?.model.name,
      draft,
      draftImages.length,
      lastObservedUsage,
      nextTurnWebSearchEnabled,
    ],
  );
  const effectiveLayoutMode =
    layoutMode === "auto"
      ? viewportProfile.prefersMobileLayout
        ? "mobile"
        : "desktop"
      : layoutMode;
  const isCompactLayout = effectiveLayoutMode === "mobile";
  const diagnosticsPanelCollapsible =
    isCompactLayout || viewportProfile.isConstrained;
  const diagnosticsPanelExpanded =
    !diagnosticsPanelCollapsible || mobileDiagnosticsExpanded;
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

  const handleDiagnosticsSwipeStart = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      if (!diagnosticsPanelCollapsible) {
        diagnosticsSwipeRef.current = null;
        return;
      }

      const touch = event.touches[0];
      if (!touch) {
        diagnosticsSwipeRef.current = null;
        return;
      }

      const targetElement = getElementTarget(event.target);
      const diagnosticsBody = targetElement?.closest(".diagnostics-body");
      const bodyScrollTop =
        diagnosticsBody instanceof HTMLElement ? diagnosticsBody.scrollTop : 0;

      diagnosticsSwipeRef.current = {
        mode: diagnosticsPanelExpanded ? "collapse" : "expand",
        startX: touch.clientX,
        startY: touch.clientY,
        bodyScrollTop,
      };
    },
    [diagnosticsPanelCollapsible, diagnosticsPanelExpanded],
  );

  const handleDiagnosticsSwipeEnd = useCallback(
    (event: TouchEvent<HTMLElement>) => {
      const swipe = diagnosticsSwipeRef.current;
      diagnosticsSwipeRef.current = null;

      if (!swipe || !diagnosticsPanelCollapsible) {
        return;
      }

      const touch = event.changedTouches[0];
      if (!touch) {
        return;
      }

      const deltaX = touch.clientX - swipe.startX;
      const deltaY = touch.clientY - swipe.startY;
      if (Math.abs(deltaX) > DIAGNOSTICS_SWIPE_HORIZONTAL_LIMIT_PX) {
        return;
      }

      if (swipe.mode === "expand" && deltaY <= -DIAGNOSTICS_SWIPE_TRIGGER_PX) {
        setMobileDiagnosticsExpanded(true);
      }

      if (
        swipe.mode === "collapse" &&
        swipe.bodyScrollTop <= SCROLL_EDGE_THRESHOLD_PX &&
        deltaY >= DIAGNOSTICS_SWIPE_TRIGGER_PX
      ) {
        setMobileDiagnosticsExpanded(false);
      }
    },
    [diagnosticsPanelCollapsible],
  );

  const cancelDiagnosticsSwipe = useCallback(() => {
    diagnosticsSwipeRef.current = null;
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
      hideMobileStatusBar,
      streamingEnabled,
      composerSubmitMode,
      messageQuoteTemplate,
      contextSummaryRawTailMessages,
      contextSummaryAutoMessageInterval,
      debugEnabled,
      apiProfileOrder: apiProfiles.map((profile) => profile.id),
      assistantOrder: assistants.map((assistant) => assistant.id),
      utilityAssistantRefs,
      modelProbeSettings,
      contextSummaryFramework,
      contextProfiles,
      contextProfileWorkflowDraft,
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
      contextProfileWorkflowDraft,
      debugEnabled,
      editingAssistantId,
      editingContextProfileId,
      hideMobileStatusBar,
      layoutMode,
      lastSuccessfulExportAt,
      messageQuoteTemplate,
      modelProbeSettings,
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
      blobs,
    }),
    [apiProfiles, appSettings, assistants, blobs, conversations, messages],
  );

  const applySnapshot = useCallback((snapshot: LocalDataSnapshot) => {
    setApiProfiles(snapshot.apiProfiles);
    setAssistants(snapshot.assistants);
    setConversations(snapshot.conversations);
    setMessages(snapshot.messages);
    setBlobs(snapshot.blobs);
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
    setHideMobileStatusBar(snapshot.settings.hideMobileStatusBar);
    setStreamingEnabled(snapshot.settings.streamingEnabled);
    setComposerSubmitMode(snapshot.settings.composerSubmitMode);
    setMessageQuoteTemplate(
      normalizeMessageQuoteTemplate(snapshot.settings.messageQuoteTemplate),
    );
    setContextSummaryRawTailMessages(
      snapshot.settings.contextSummaryRawTailMessages,
    );
    setContextSummaryAutoMessageInterval(
      snapshot.settings.contextSummaryAutoMessageInterval,
    );
    setDebugEnabled(snapshot.settings.debugEnabled);
    setUtilityAssistantRefs(snapshot.settings.utilityAssistantRefs);
    setModelProbeSettings(snapshot.settings.modelProbeSettings);
    setContextSummaryFramework(snapshot.settings.contextSummaryFramework);
    setContextProfiles(snapshot.settings.contextProfiles);
    setContextProfileWorkflowDraft(
      snapshot.settings.contextProfileWorkflowDraft,
    );
    setEditingContextProfileId(snapshot.settings.editingContextProfileId);
    setLastSuccessfulExportAt(snapshot.settings.lastSuccessfulExportAt);
    setDraftImages([]);
    setComposerNotice("");
    setImagePreview(null);
    setSelectedMessageText(null);
    setStreamingTextChunks({});
    streamingFullTextRef.current = {};
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
        JSON.stringify({ themeMode, layoutMode, hideMobileStatusBar }),
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
  }, [hideMobileStatusBar, layoutMode, themeMode]);

  useEffect(() => {
    try {
      window.MobileChatAndroid?.setStatusBarHidden?.(hideMobileStatusBar);
    } catch {
      // The Android bridge is optional; desktop browsers keep normal chrome.
    }
  }, [hideMobileStatusBar]);

  useEffect(() => {
    updateMessageThreadScrollState();
    window.addEventListener("scroll", updateMessageThreadScrollState, {
      passive: true,
    });
    window.addEventListener("resize", updateMessageThreadScrollState);
    return () => {
      window.removeEventListener("scroll", updateMessageThreadScrollState);
      window.removeEventListener("resize", updateMessageThreadScrollState);
    };
  }, [activeMessages.length, updateMessageThreadScrollState]);

  useEffect(() => {
    if (pendingMessageId && shouldFollowMessageBottomRef.current) {
      scheduleScrollMessageThreadToBottom("auto");
      return;
    }

    updateMessageThreadScrollState();
  }, [
    activeMessages,
    pendingMessageId,
    scheduleScrollMessageThreadToBottom,
    updateMessageThreadScrollState,
  ]);

  useEffect(() => {
    setContextSummaryPreviewOpen(false);
    setContextSummaryStatus("");
  }, [activeConversation?.id]);

  useEffect(() => {
    setModelProbeGroupIdDraft(editingModelProbeGroup?.id ?? "");
  }, [editingModelProbeGroup?.id]);

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
      ttsAbortControllerRef.current?.abort();
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      if (scrollFollowFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFollowFrameRef.current);
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

  const appendStreamingMessageText = useCallback(
    (messageId: string, delta: string, fullText: string) => {
      const previousText = streamingFullTextRef.current[messageId] ?? "";
      let nextDelta = delta;

      if (!nextDelta && fullText.startsWith(previousText)) {
        nextDelta = fullText.slice(previousText.length);
      }

      if (previousText && fullText && !fullText.startsWith(previousText)) {
        streamingFullTextRef.current[messageId] = fullText;
        setStreamingTextChunks((current) => ({
          ...current,
          [messageId]: [fullText],
        }));
        return;
      }

      if (!nextDelta) {
        return;
      }

      streamingFullTextRef.current[messageId] =
        fullText || `${previousText}${nextDelta}`;
      setStreamingTextChunks((current) => ({
        ...current,
        [messageId]: [...(current[messageId] ?? []), nextDelta],
      }));
    },
    [],
  );

  const finalizeStreamingMessageText = useCallback(
    (messageId: string, finalText: string) => {
      const previousText = streamingFullTextRef.current[messageId];
      if (!previousText || !finalText) {
        return;
      }

      if (finalText === previousText) {
        return;
      }

      appendStreamingMessageText(
        messageId,
        finalText.startsWith(previousText)
          ? finalText.slice(previousText.length)
          : finalText,
        finalText,
      );
    },
    [appendStreamingMessageText],
  );

  const clearStreamingMessageText = useCallback((messageId: string) => {
    delete streamingFullTextRef.current[messageId];
    setStreamingTextChunks((current) => {
      if (!current[messageId]) {
        return current;
      }

      const next = { ...current };
      delete next[messageId];
      return next;
    });
  }, []);

  const captureMessageTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setSelectedMessageText(null);
      return;
    }

    const selectedText = normalizeQuotedText(selection.toString());
    if (!selectedText) {
      setSelectedMessageText(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const startElement =
      range.startContainer instanceof Element
        ? range.startContainer
        : range.startContainer.parentElement;
    const endElement =
      range.endContainer instanceof Element
        ? range.endContainer
        : range.endContainer.parentElement;
    const startTextElement = startElement?.closest<HTMLElement>(
      "[data-message-text]",
    );
    const endTextElement = endElement?.closest<HTMLElement>(
      "[data-message-text]",
    );

    if (
      !startTextElement ||
      startTextElement !== endTextElement ||
      !messageThreadRef.current?.contains(startTextElement)
    ) {
      setSelectedMessageText(null);
      return;
    }

    const messageElement =
      startTextElement.closest<HTMLElement>("[data-message-id]");
    const messageId = messageElement?.dataset.messageId;
    if (!messageId) {
      setSelectedMessageText(null);
      return;
    }

    setSelectedMessageText({ messageId, text: selectedText });
  }, []);

  const captureMessageTextSelectionAfterTouch = useCallback(() => {
    window.setTimeout(captureMessageTextSelection, 0);
  }, [captureMessageTextSelection]);

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
    setDraftImages([]);
    setComposerNotice("");
    setEditingTitleConversationId(null);
    setTitleDraft("");
    stopResponse("已停止上一条未完成回复。");
  };

  const selectConversation = (conversationId: string) => {
    setActiveConversationId(conversationId);
    setDrawerOpen(false);
    setDraft("");
    setDraftImages([]);
    setComposerNotice("");
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

    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, archived: true }
          : conversation,
      ),
    );
    setShowArchived(true);
    setConversationSearch("");
    setActiveConversationId(activeConversation.id);
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
    const deletedConversationBlobIds = new Set(
      messages
        .filter((message) => message.conversationId === deletedConversation.id)
        .flatMap((message) =>
          getMessageImageParts(message).map((part) => part.blobId),
        ),
    );
    if (deletedConversationBlobIds.size > 0) {
      setBlobs((current) =>
        current.filter((blob) => {
          if (!deletedConversationBlobIds.has(blob.id)) {
            return true;
          }
          const referencedByRemainingMessage = messages.some(
            (message) =>
              message.conversationId !== deletedConversation.id &&
              getMessageImageParts(message).some(
                (part) => part.blobId === blob.id,
              ),
          );
          const referencedByDraft = draftImages.some(
            (image) => image.blobId === blob.id,
          );
          return referencedByRemainingMessage || referencedByDraft;
        }),
      );
    }
    setActiveConversationId(nextConversation?.id ?? "");
    setShowArchived(
      deletedConversation.archived && remainingArchived.length > 0,
    );
    setConversationSearch("");
    setDrawerOpen(false);
    setDraft("");
    setDraftImages([]);
    setComposerNotice("");
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

  const blobToBase64 = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () =>
        reject(reader.error ?? new Error("无法读取导出文件。"));
      reader.readAsDataURL(blob);
    });

  const saveArchiveWithAndroidBridge = async (blob: Blob, fileName: string) => {
    if (!window.MobileChatAndroid?.saveArchive) {
      return null;
    }

    const base64Data = await blobToBase64(blob);
    const rawResult = window.MobileChatAndroid.saveArchive(
      fileName,
      base64Data,
    );

    try {
      const result = JSON.parse(rawResult) as {
        ok?: boolean;
        path?: string;
        error?: string;
      };
      if (!result.ok) {
        throw new Error(result.error || "Android 保存导出文件失败。");
      }
      return result.path || `/sdcard/Download/MobileChat/${fileName}`;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("Android 保存接口返回了无法解析的结果。");
      }
      throw error;
    }
  };

  const downloadArchive = async (blob: Blob) => {
    const fileName = createArchiveDownloadName();
    const androidPath = await saveArchiveWithAndroidBridge(blob, fileName);
    if (androidPath) {
      return `已导出到 ${androidPath}`;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return "已生成 credential-free .mobilechat 导出文件";
  };

  const exportBackup = async () => {
    setBackupMessage("正在导出 .mobilechat");
    await saveCurrentSnapshot();

    try {
      const committedSnapshot = await loadSnapshot();
      const archive = await createMobileChatArchive(committedSnapshot, {
        includeCredentials: false,
      });
      const exportMessage = await downloadArchive(archive);

      const exportedAt = new Date().toISOString();
      const snapshotWithExportTime =
        await updateLastSuccessfulExport(exportedAt);
      applySnapshot(snapshotWithExportTime);
      setBackupMessage(exportMessage);
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

  const clearImageCache = () => {
    if (imageCacheStats.count === 0) {
      setBackupMessage("当前没有图片缓存。");
      return;
    }

    if (
      !confirmDestructiveAction(
        `清理 ${imageCacheStats.count} 张本地图片缓存？消息中的图片占位会保留，但旧图片不能继续预览或随重试再次发送。`,
      )
    ) {
      return;
    }

    setBlobs([]);
    setDraftImages([]);
    setComposerNotice("");
    setImagePreview(null);
    setBackupMessage(
      `已清理 ${imageCacheStats.count} 张图片缓存（${formatBytes(
        imageCacheStats.bytes,
      )}）。`,
    );
  };

  const addDraftImageFiles = async (files: File[]) => {
    if (files.length === 0 || activeConversationReadOnly || pendingMessageId) {
      return;
    }

    const availableSlots = Math.max(0, MAX_DRAFT_IMAGES - draftImages.length);
    if (availableSlots === 0) {
      setComposerNotice(`每轮最多附加 ${MAX_DRAFT_IMAGES} 张图片。`);
      return;
    }

    const acceptedFiles = files.slice(0, availableSlots);
    const skipped = files.length - acceptedFiles.length;
    const now = new Date().toISOString();
    const nextBlobs: LocalBlobRecord[] = [];
    const nextDraftImages: DraftImage[] = [];
    const notices: string[] = [];
    const currentMaxReferenceNumber = draftImages.reduce(
      (max, image) =>
        Math.max(max, readImageReferenceNumber(image.referenceLabel)),
      0,
    );

    for (const file of acceptedFiles) {
      if (!file.type.startsWith("image/")) {
        notices.push(`已跳过非图片文件：${file.name}`);
        continue;
      }

      if (file.size > MAX_DRAFT_IMAGE_BYTES) {
        notices.push(
          `已跳过过大的图片：${file.name}（${formatBytes(file.size)}）`,
        );
        continue;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        const blobId = createId("blob");
        const referenceLabel = `图片${
          currentMaxReferenceNumber + nextDraftImages.length + 1
        }`;
        const imagePart: MessageImagePart = {
          id: createId("image"),
          type: "image",
          blobId,
          mimeType: file.type || "image/*",
          name: file.name || `${referenceLabel}.png`,
          size: file.size,
          referenceLabel,
        };
        nextBlobs.push({
          id: blobId,
          kind: "image",
          mimeType: imagePart.mimeType,
          name: imagePart.name,
          size: imagePart.size,
          dataUrl,
          createdAt: now,
        });
        nextDraftImages.push({
          ...imagePart,
          previewUrl: dataUrl,
        });
      } catch (error) {
        notices.push(
          error instanceof Error ? error.message : `图片读取失败：${file.name}`,
        );
      }
    }

    if (nextBlobs.length > 0) {
      setBlobs((current) => [...current, ...nextBlobs]);
      setDraftImages((current) => [...current, ...nextDraftImages]);
      setDraft((current) => {
        const references = nextDraftImages
          .map((image) => `[${image.referenceLabel ?? "图片"}]`)
          .join("\n");
        if (!references) {
          return current;
        }
        return current.trim()
          ? `${current.replace(/\s*$/, "")}\n${references}`
          : references;
      });
    }

    if (skipped > 0) {
      notices.push(
        `已达到每轮 ${MAX_DRAFT_IMAGES} 张上限，跳过 ${skipped} 个文件。`,
      );
    }
    setComposerNotice(notices.join("；"));
  };

  const handleDraftImageInput = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await addDraftImageFiles(files);
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const filesFromItems = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const filesFromList = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    const seen = new Set<string>();
    const files = [...filesFromList, ...filesFromItems].filter((file) => {
      const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    void addDraftImageFiles(files);
  };

  const removeDraftImage = (imageId: string) => {
    const target = draftImages.find((image) => image.id === imageId);
    if (!target) {
      return;
    }

    setDraftImages((current) =>
      current.filter((image) => image.id !== imageId),
    );
    if (target.referenceLabel) {
      const markerPattern = new RegExp(
        `(^|\\n)\\[${escapeRegExp(target.referenceLabel)}\\](?=\\n|$)`,
        "g",
      );
      setDraft((current) =>
        current
          .replace(markerPattern, "")
          .replace(/\n{3,}/g, "\n\n")
          .trimStart(),
      );
    }
    const blobStillReferencedByMessage = messages.some((message) =>
      getMessageImageParts(message).some(
        (part) => part.blobId === target.blobId,
      ),
    );
    if (!blobStillReferencedByMessage) {
      setBlobs((current) =>
        current.filter((blob) => blob.id !== target.blobId),
      );
    }
    setComposerNotice("");
  };

  const openImagePreview = ({
    src,
    label,
    name,
    size,
  }: {
    src: string;
    label: string;
    name: string;
    size: number;
  }) => {
    setImagePreview({ src, label, name, size });
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
    setEditingModelId("");
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
    key: keyof Pick<ModelDefinition, "id" | "name" | "description" | "enabled">,
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
                      [key]: key === "id" ? nextModelId : value,
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

  const updateModelProbeSettings = (
    updater: (current: ModelProbeSettings) => ModelProbeSettings,
  ) => {
    setModelProbeSettings((current) =>
      normalizeModelProbeSettings(updater(current)),
    );
  };

  const updateModelProbeGroup = (
    groupId: string,
    updater: (group: ModelProbeGroup) => ModelProbeGroup,
  ) => {
    updateModelProbeSettings((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id === groupId ? updater(group) : group,
      ),
    }));
  };

  const createModelProbeGroup = () => {
    const nextGroup = createEmptyModelProbeGroup(
      modelProbeSettings.groups.length + 1,
    );
    updateModelProbeSettings((current) => ({
      ...current,
      groups: [...current.groups, nextGroup],
      editingGroupId: nextGroup.id,
    }));
  };

  const deleteModelProbeGroup = (groupId: string) => {
    const targetGroup = modelProbeSettings.groups.find(
      (group) => group.id === groupId,
    );
    if (!targetGroup) {
      return;
    }
    if (
      !confirmDestructiveAction(
        `删除探测「${targetGroup.name}」？这不会影响已创建的模型配置。`,
      )
    ) {
      return;
    }

    updateModelProbeSettings((current) => {
      const remainingGroups = current.groups.filter(
        (group) => group.id !== groupId,
      );
      const groups =
        remainingGroups.length > 0
          ? remainingGroups
          : [createEmptyModelProbeGroup(1)];
      return {
        ...current,
        groups,
        editingGroupId: groups[0]?.id ?? "",
      };
    });
  };

  const moveModelProbeGroup = (groupId: string, direction: -1 | 1) => {
    updateModelProbeSettings((current) => ({
      ...current,
      groups: moveListItemById(current.groups, groupId, direction),
    }));
  };

  const commitModelProbeGroupIdDraft = () => {
    if (!editingModelProbeGroup) {
      return;
    }

    const nextId = modelProbeGroupIdDraft.trim();
    const currentId = editingModelProbeGroup.id;

    if (nextId === currentId) {
      setModelProbeGroupIdDraft(currentId);
      return;
    }

    if (!nextId) {
      setModelProbeGroupIdDraft(currentId);
      setModelProbeStatus("模型 ID 不能为空，已恢复原值。");
      return;
    }

    if (
      modelProbeSettings.groups.some(
        (group) => group.id === nextId && group.id !== currentId,
      )
    ) {
      setModelProbeGroupIdDraft(currentId);
      setModelProbeStatus(`模型 ID「${nextId}」已存在，已恢复原值。`);
      return;
    }

    updateModelProbeSettings((current) => ({
      ...current,
      editingGroupId: nextId,
      groups: current.groups.map((group) =>
        group.id === currentId ? { ...group, id: nextId } : group,
      ),
    }));
    setModelProbeStatus("");
  };

  const resetModelProbeSettings = () => {
    if (
      !confirmDestructiveAction(
        "还原默认模型探测规则？当前自定义探测会被覆盖。",
      )
    ) {
      return;
    }
    setModelProbeSettings(
      normalizeModelProbeSettings(defaultModelProbeSettings),
    );
    setModelProbeResults([]);
    setModelProbeStatus("已还原默认模型探测规则。");
  };

  const updateModelProbeRule = (
    groupId: string,
    ruleId: string,
    updater: (rule: ModelProbeRule) => ModelProbeRule,
  ) => {
    updateModelProbeGroup(groupId, (group) => ({
      ...group,
      rules: group.rules.map((rule) =>
        rule.id === ruleId ? updater(rule) : rule,
      ),
    }));
  };

  const updateModelProbeRuleDimension = (
    groupId: string,
    ruleId: string,
    key: string,
    value: ModelProbeDimensionValue,
  ) => {
    updateModelProbeRule(groupId, ruleId, (rule) => ({
      ...rule,
      dimensions: {
        ...rule.dimensions,
        [key]: value,
      },
    }));
  };

  const deleteModelProbeRuleDimension = (
    groupId: string,
    ruleId: string,
    key: string,
  ) => {
    updateModelProbeRule(groupId, ruleId, (rule) => {
      const dimensions = { ...rule.dimensions };
      delete dimensions[key];
      return {
        ...rule,
        dimensions,
      };
    });
  };

  const addModelProbeRuleDimension = (
    groupId: string,
    ruleId: string,
    key: string,
  ) => {
    updateModelProbeRule(groupId, ruleId, (rule) => {
      if (rule.dimensions[key] !== undefined) {
        return rule;
      }

      return {
        ...rule,
        dimensions: {
          ...rule.dimensions,
          [key]:
            key === "version"
              ? { type: "minorTenths", majors: ["1"], from: 0, to: 9 }
              : [""],
        },
      };
    });
  };

  const runModelProbe = async () => {
    if (modelProbeRunning) {
      return;
    }
    if (!editingModelProbeGroup) {
      setModelProbeStatus("请先选择探测。");
      return;
    }
    if (!modelProbeSelectedApiProfile) {
      setModelProbeStatus("请先选择用于执行探测的连接配置。");
      return;
    }
    if (!modelProbeSelectedApiProfile.baseUrl.trim()) {
      setModelProbeStatus("探测连接缺少 Base URL。");
      return;
    }
    if (!modelProbeSelectedApiProfile.apiKey.trim()) {
      setModelProbeStatus("探测连接缺少 API Key。");
      return;
    }
    if (modelProbeCandidates.length === 0) {
      setModelProbeStatus("当前探测没有候选模型。");
      return;
    }

    setModelProbeRunning(true);
    setModelProbeResults([]);
    setModelProbeStatus(
      `正在探测 ${modelProbeCandidates.length} 个候选；协议跟随连接「${modelProbeSelectedApiProfile.protocol}」。`,
    );

    try {
      const results = await runModelProbePool({
        apiProfile: modelProbeSelectedApiProfile,
        candidates: modelProbeCandidates,
        concurrency: MODEL_PROBE_CONCURRENCY,
        timeoutMs: modelProbeSettings.timeoutMs,
      });
      const successCount = results.filter((result) => result.ok).length;
      setModelProbeResults(results);
      setModelProbeStatus(
        `探测完成：${successCount}/${results.length} 个候选可用。失败通常不产生输出 token，但会消耗网关请求。`,
      );
    } catch (error) {
      setModelProbeStatus(
        error instanceof Error ? error.message : "模型探测失败。",
      );
    } finally {
      setModelProbeRunning(false);
    }
  };

  const createModelFromProbeResult = (result: ModelProbeResult) => {
    const targetProfile = modelProbeSelectedApiProfile;
    if (!targetProfile || !result.ok) {
      return;
    }

    const alreadyExists = targetProfile.models.some(
      (model) => model.id === result.modelId,
    );
    if (alreadyExists) {
      setEditingApiProfileId(targetProfile.id);
      setEditingModelId(result.modelId);
      setModelProbeStatus(`模型「${result.modelId}」已存在，已切换到该模型。`);
      return;
    }

    const nextModel: ModelDefinition = {
      id: result.modelId,
      name: result.modelId,
      description: "",
      enabled: true,
    };

    setApiProfiles((current) =>
      current.map((profile) =>
        profile.id === targetProfile.id
          ? { ...profile, models: [...profile.models, nextModel] }
          : profile,
      ),
    );
    setEditingApiProfileId(targetProfile.id);
    setEditingModelId(result.modelId);
    setModelProbeStatus(`已创建模型配置「${result.modelId}」。`);
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

  const updateContextProfileSummaryMaxChars = (
    profileId: string,
    value: number,
  ) => {
    setContextProfiles((current) =>
      current.map((profile) =>
        profile.id === profileId
          ? {
              ...profile,
              summaryMaxChars: normalizeContextProfileSummaryMaxChars(value),
            }
          : profile,
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

  const updateContextProfileWorkflowField = (
    key: keyof ContextProfileWorkflowDraft,
    value: string,
  ) => {
    setContextProfileWorkflowDraft((current) => ({
      ...current,
      [key]: value,
    }));
    setContextProfileWorkflowStatus("");
  };

  const copyContextProfileWorkflowPrompt = async (
    mode: ContextProfileWorkflowPromptMode,
  ) => {
    const prompt = buildContextProfileWorkflowPrompt({
      mode,
      framework: contextSummaryFramework,
      profile: editingContextProfile,
      assistant: editingAssistant,
    });

    try {
      await copyTextToClipboard(prompt);
      setContextProfileWorkflowStatus(
        mode === "start" ? "已复制起始说明。" : "已复制导出说明。",
      );
    } catch (error) {
      setContextProfileWorkflowStatus(
        error instanceof Error
          ? error.message
          : "复制失败，请手动选中提示词内容。",
      );
    }
  };

  const createContextProfileFromWorkflowOutput = () => {
    try {
      const parsedProfile = parseContextProfileWorkflowOutput(
        contextProfileWorkflowDraft.standardOutput,
        contextSummaryFramework,
      );
      const newProfile: ContextProfile = {
        id: createId("context-profile"),
        ...parsedProfile,
      };
      setContextProfiles((current) => [...current, newProfile]);
      setEditingContextProfileId(newProfile.id);
      setContextProfileWorkflowStatus(
        `已解析并新建上下文配置「${newProfile.name}」。`,
      );
    } catch (error) {
      setContextProfileWorkflowStatus(
        error instanceof Error
          ? error.message
          : "解析失败，请检查标准输出 JSON。",
      );
    } finally {
      setContextProfileWorkflowDraft(defaultContextProfileWorkflowDraft);
    }
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
    clearStreamingMessageText(messageId);

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

    const deletedBlobIds = new Set(
      getMessageImageParts(targetMessage).map((part) => part.blobId),
    );
    setMessages((current) =>
      current.filter((message) => message.id !== messageId),
    );
    if (deletedBlobIds.size > 0) {
      setBlobs((current) =>
        current.filter((blob) => {
          if (!deletedBlobIds.has(blob.id)) {
            return true;
          }
          const referencedByOtherMessage = messages.some(
            (message) =>
              message.id !== messageId &&
              getMessageImageParts(message).some(
                (part) => part.blobId === blob.id,
              ),
          );
          const referencedByDraft = draftImages.some(
            (image) => image.blobId === blob.id,
          );
          return referencedByOtherMessage || referencedByDraft;
        }),
      );
    }
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
    const summaryMaxChars = normalizeContextProfileSummaryMaxChars(
      contextProfile.summaryMaxChars,
    );
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
        maxChars: summaryMaxChars,
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
        blobs: [],
        signal: controller.signal,
        stream: false,
        webSearchEnabled: false,
      });
      let contextSummary = result.text.trim();

      if (!contextSummary) {
        throw new Error("总结助手未返回文本。");
      }

      if (contextSummary.length > summaryMaxChars) {
        setContextSummaryStatus(
          `${
            trigger === "auto" ? "自动上下文总结" : "上下文总结"
          }超出 ${summaryMaxChars} 字，正在要求总结助手重写。`,
        );
        const rewriteMessage: Message = {
          id: createId("summary-rewrite-request"),
          conversationId: conversation.id,
          role: "user",
          label: "上下文总结重写请求",
          text: buildContextSummaryRewritePrompt({
            summary: contextSummary,
            maxChars: summaryMaxChars,
            framework: contextSummaryFramework,
            contextProfile,
          }),
          createdAt: new Date().toISOString(),
          status: "complete",
        };
        const rewriteResult = await requestResponsesChat({
          apiProfile: summaryResolvedModel.apiProfile,
          assistant: summaryAssistant,
          conversation,
          model: summaryResolvedModel.model,
          messages: [rewriteMessage],
          blobs: [],
          signal: controller.signal,
          stream: false,
          webSearchEnabled: false,
        });
        contextSummary = rewriteResult.text.trim();

        if (!contextSummary) {
          throw new Error("总结助手重写后未返回文本。");
        }
      }

      if (contextSummary.length > summaryMaxChars) {
        throw new Error(
          `总结长度 ${contextSummary.length} 字符超过当前上下文配置上限 ${summaryMaxChars}，未启用新总结。`,
        );
      }

      const latestConversationMessages = sortMessagesByCreatedAt(
        latestSnapshotRef.current.messages.filter(
          (message) => message.conversationId === conversation.id,
        ),
      );
      const latestSummarizableMessages = latestConversationMessages.filter(
        (message) =>
          message.status !== "streaming" && hasMessageContent(message),
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
        contextProfileSummaryMaxCharsSnapshot: summaryMaxChars,
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
      (message) => message.status !== "streaming" && hasMessageContent(message),
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
        (message) =>
          message.status !== "streaming" && hasMessageContent(message),
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
    idsToRemove.forEach(clearStreamingMessageText);
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
      startFollowingMessageBottom();
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
    setLastObservedUsage(undefined);
    setMessages((current) => [
      ...current.filter((message) => !idsToRemove.has(message.id)),
      assistantMessage,
    ]);
    setPendingMessageId(assistantMessage.id);
    startFollowingMessageBottom();
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
        blobs,
        signal: controller.signal,
        stream: streamingEnabled,
        webSearchEnabled: requestWebSearchEnabled,
        onTextDelta: streamingEnabled
          ? (_delta, fullText) => {
              streamedText = fullText;
              appendStreamingMessageText(assistantMessage.id, _delta, fullText);
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
      finalizeStreamingMessageText(
        assistantMessage.id,
        completedAssistantMessage.text,
      );
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
      clearStreamingMessageText(assistantMessage.id);
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
    idsToRemove.forEach(clearStreamingMessageText);
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
      startFollowingMessageBottom();
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
    setLastObservedUsage(undefined);
    setMessages((current) => [
      ...current.filter((message) => !idsToRemove.has(message.id)),
      assistantMessage,
    ]);
    setPendingMessageId(assistantMessage.id);
    startFollowingMessageBottom();
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
        blobs,
        signal: controller.signal,
        stream: streamingEnabled,
        webSearchEnabled: requestWebSearchEnabled,
        onTextDelta: streamingEnabled
          ? (_delta, fullText) => {
              streamedText = fullText;
              appendStreamingMessageText(assistantMessage.id, _delta, fullText);
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
      finalizeStreamingMessageText(
        assistantMessage.id,
        completedAssistantMessage.text,
      );
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
      clearStreamingMessageText(assistantMessage.id);
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
    const outgoingImages = draftImages;
    const resolvedModel = activeResolvedModel;

    if (
      (!text && outgoingImages.length === 0) ||
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
      setDraftImages([]);
      setComposerNotice("");
      setMessages((current) => [...current, assistantMessage]);
      startFollowingMessageBottom();
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
      imageParts: outgoingImages.map(
        ({ previewUrl: _previewUrl, ...part }) => part,
      ),
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
    setDraftImages([]);
    setComposerNotice("");
    setNextTurnWebSearchEnabled(false);
    setLastObservedUsage(undefined);
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setPendingMessageId(assistantMessage.id);
    startFollowingMessageBottom();
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === activeConversation.id
          ? {
              ...conversation,
              summary: `最近消息：${(text || `${outgoingImages.length} 张图片`).slice(0, 28)}`,
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
        blobs,
        signal: controller.signal,
        stream: streamingEnabled,
        webSearchEnabled: requestWebSearchEnabled,
        onTextDelta: streamingEnabled
          ? (_delta, fullText) => {
              streamedText = fullText;
              appendStreamingMessageText(assistantMessage.id, _delta, fullText);
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
      finalizeStreamingMessageText(
        assistantMessage.id,
        completedAssistantMessage.text,
      );
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
      clearStreamingMessageText(assistantMessage.id);
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

  const insertComposerTextBlock = (text: string) => {
    const input = composerInputRef.current;
    const selectionStart = input?.selectionStart ?? draft.length;
    const selectionEnd = input?.selectionEnd ?? draft.length;
    const before = draft.slice(0, selectionStart);
    const after = draft.slice(selectionEnd);
    const prefix = before === "" || before.endsWith("\n") ? "" : "\n";
    const suffix = after === "" || after.startsWith("\n") ? "" : "\n";
    const insertion = `${prefix}${text}${suffix}`;
    const nextDraft = `${before}${insertion}${after}`;

    setDraft(nextDraft);
    window.requestAnimationFrame(() => {
      const nextInput = composerInputRef.current;
      if (!nextInput) {
        return;
      }

      const cursor = before.length + insertion.length;
      nextInput.focus();
      nextInput.selectionStart = cursor;
      nextInput.selectionEnd = cursor;
      resizeComposerInput();
    });
  };

  const insertSelectedMessageQuote = (messageId: string) => {
    const selectedText =
      selectedMessageText?.messageId === messageId
        ? selectedMessageText.text
        : "";
    if (!selectedText) {
      return;
    }

    insertComposerTextBlock(
      formatMessageQuote(messageQuoteTemplate, selectedText),
    );
    setComposerNotice("已引用选中文本");
  };

  const getMessageTextForTts = (message: Message) => {
    const streamingText =
      streamingFullTextRef.current[message.id] ||
      (streamingTextChunks[message.id] ?? []).join("");
    return normalizeQuotedText(streamingText || message.text);
  };

  const speakMessageWithTts = async (message: Message) => {
    const text = getMessageTextForTts(message);
    if (!text) {
      setComposerNotice("这条消息没有可朗读文本");
      return;
    }

    ttsAbortControllerRef.current?.abort();
    const controller = new AbortController();
    ttsAbortControllerRef.current = controller;

    try {
      const response = await fetch(TTS_SPEAK_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          mode: TTS_SPEAK_MODE,
          meta: {
            source: "mobile-chat",
            messageId: message.id,
            conversationId: message.conversationId,
            role: message.role,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`TTS 朗读请求失败：HTTP ${response.status}`);
      }

      setComposerNotice("已发送朗读请求");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      setComposerNotice(
        error instanceof Error ? error.message : "TTS 朗读请求失败",
      );
    } finally {
      if (ttsAbortControllerRef.current === controller) {
        ttsAbortControllerRef.current = null;
      }
    }
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

  const scrollMessageThreadToTop = () => {
    const thread = messageThreadRef.current;
    shouldFollowMessageBottomRef.current = false;
    userThreadScrollIntentRef.current = true;
    thread?.scrollTo?.({ top: 0, behavior: "smooth" });
    if (document.body.scrollHeight > window.innerHeight) {
      window.scrollTo?.({ top: 0, behavior: "smooth" });
    }
  };

  const scrollMessageThreadToBottomFromButton = () => {
    startFollowingMessageBottom();
  };

  const jumpMessageSearchResult = (direction: -1 | 1) => {
    const total = messageSearch.ids.length;
    if (total === 0) {
      return;
    }

    setActiveMessageSearchIndex(
      (current) => (current + direction + total) % total,
    );
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
                <p>
                  {[
                    message.text.trim(),
                    ...getMessageImageParts(message).map(
                      formatMessageImageMarker,
                    ),
                  ]
                    .filter(Boolean)
                    .join("\n") || "[空消息]"}
                </p>
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
      className={`app-shell ${effectiveLayoutMode}-layout ${
        viewportProfile.isConstrained ? "constrained-viewport" : ""
      } ${viewportProfile.isLandscape ? "landscape-viewport" : ""}`}
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

        <div className="conversation-search">
          <label className="search-box">
            <Search size={18} />
            <input
              placeholder={
                showArchived ? "搜索归档标题或摘要" : "搜索标题或摘要"
              }
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.target.value)}
            />
          </label>
          <button
            className={`conversation-search-mode ${
              conversationSearchRegexEnabled ? "active" : ""
            }`}
            type="button"
            aria-label="对话正则搜索"
            aria-pressed={conversationSearchRegexEnabled}
            onClick={() =>
              setConversationSearchRegexEnabled((enabled) => !enabled)
            }
          >
            正则
          </button>
          {conversationSearchResult.error ? (
            <span className="conversation-search-error">正则无效</span>
          ) : null}
        </div>

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
            className="icon-button mobile-only chat-top-button"
            type="button"
            aria-label="回到消息顶部"
            onClick={scrollMessageThreadToTop}
          >
            <ArrowUpToLine size={20} />
          </button>
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

        <section className="message-search-panel" aria-label="消息搜索">
          <label className="message-search-input">
            <Search size={16} />
            <input
              aria-label="搜索当前对话消息"
              placeholder="搜索当前对话消息；空格表示任意间隔"
              value={messageSearchQuery}
              onChange={(event) => setMessageSearchQuery(event.target.value)}
            />
          </label>
          <button
            className={`message-search-mode ${
              messageSearchRegexEnabled ? "active" : ""
            }`}
            type="button"
            aria-label="正则搜索"
            aria-pressed={messageSearchRegexEnabled}
            onClick={() => setMessageSearchRegexEnabled((enabled) => !enabled)}
          >
            正则
          </button>
          <button
            type="button"
            aria-label="上一个搜索结果"
            disabled={messageSearch.ids.length === 0}
            onClick={() => jumpMessageSearchResult(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="下一个搜索结果"
            disabled={messageSearch.ids.length === 0}
            onClick={() => jumpMessageSearchResult(1)}
          >
            ↓
          </button>
          <span
            className={`message-search-status ${
              messageSearch.error ? "error" : ""
            }`}
            title={messageSearch.error || undefined}
          >
            {messageSearch.error
              ? "正则无效"
              : messageSearchQuery.trim()
                ? `${messageSearch.ids.length > 0 ? activeMessageSearchIndex + 1 : 0}/${messageSearch.ids.length}`
                : "未搜索"}
          </span>
        </section>

        <div className="message-thread-shell">
          <div
            className="message-thread"
            aria-label="消息列表"
            ref={messageThreadRef}
            onMouseUp={captureMessageTextSelection}
            onScroll={updateMessageThreadScrollState}
            onTouchEnd={captureMessageTextSelectionAfterTouch}
            onTouchMove={markManualMessageThreadScrollIntent}
            onWheel={markManualMessageThreadScrollIntent}
          >
            {activeMessages.length > 0 ? (
              activeMessages.map((message) => {
                const createdTime = formatMessageTime(message.createdAt);
                const completedTime = formatMessageTime(message.completedAt);
                const elapsedText = formatElapsedMs(message.elapsedMs);
                const isSearchHit = messageSearch.ids.includes(message.id);
                const ttsText = getMessageTextForTts(message);

                return (
                  <article
                    className={`message ${message.role} ${
                      isSearchHit ? "search-hit" : ""
                    } ${message.id === activeMessageSearchId ? "search-active" : ""}`}
                    data-message-id={message.id}
                    key={message.id}
                  >
                    <div className="message-label">
                      {message.label}
                      {createdTime ? ` · ${createdTime}` : ""}
                      {message.status === "streaming" ? " · 生成中" : ""}
                      {message.status === "stopped" ? " · 已停止" : ""}
                      {message.status === "error" ? " · 错误" : ""}
                    </div>
                    <p data-message-text>
                      {streamingTextChunks[message.id]?.length
                        ? streamingTextChunks[message.id].map(
                            (chunk, index) => (
                              <span key={`${message.id}-chunk-${index}`}>
                                {chunk}
                              </span>
                            ),
                          )
                        : message.text}
                    </p>
                    {getMessageImageParts(message).length > 0 ? (
                      <div className="message-images" aria-label="消息图片">
                        {getMessageImageParts(message).map((part, index) => {
                          const blob = blobMap.get(part.blobId);
                          const imageLabel =
                            part.referenceLabel ?? `图片${index + 1}`;
                          return blob ? (
                            <button
                              className="message-image"
                              key={part.id}
                              type="button"
                              title={`${part.name} · ${formatBytes(part.size)}`}
                              onClick={() =>
                                openImagePreview({
                                  src: blob.dataUrl,
                                  label: imageLabel,
                                  name: part.name,
                                  size: part.size,
                                })
                              }
                            >
                              <img src={blob.dataUrl} alt={part.name} />
                              <span>
                                {imageLabel} · {part.name}
                              </span>
                            </button>
                          ) : (
                            <div
                              className="message-image missing"
                              key={part.id}
                            >
                              <ImageIcon size={18} />
                              <span>
                                {imageLabel} · {part.name} · 图片缓存已清理
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                    {completedTime || elapsedText ? (
                      <div className="message-meta">
                        {completedTime ? (
                          <span>完成 {completedTime}</span>
                        ) : null}
                        {elapsedText ? <span>用时 {elapsedText}</span> : null}
                      </div>
                    ) : null}
                    <div className="message-actions">
                      <button
                        type="button"
                        aria-label="引用选中文本"
                        disabled={
                          activeConversationReadOnly ||
                          selectedMessageText?.messageId !== message.id
                        }
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => insertSelectedMessageQuote(message.id)}
                        title={
                          selectedMessageText?.messageId === message.id
                            ? "将当前选中文本插入输入框"
                            : "先选中这条消息中的文本片段"
                        }
                      >
                        <TextQuote size={14} />
                        引用
                      </button>
                      {debugEnabled ? (
                        <button
                          type="button"
                          aria-label="朗读消息"
                          disabled={!ttsText}
                          onClick={() => void speakMessageWithTts(message)}
                          title={
                            ttsText
                              ? "调用本地 TTS 接口朗读这条消息"
                              : "这条消息没有可朗读文本"
                          }
                        >
                          <Volume2 size={14} />
                          朗读
                        </button>
                      ) : null}
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
                  请先在设置页配置连接、API key、模型，并把模型绑定到聊天助手。
                </p>
              </section>
            )}
          </div>
          {isMessageThreadAwayFromBottom ? (
            <button
              className="message-scroll-action"
              type="button"
              aria-label="回到消息底部"
              onClick={scrollMessageThreadToBottomFromButton}
            >
              ↓ 底部
            </button>
          ) : null}
        </div>

        {debugEnabled ? (
          <section
            className={`diagnostics-panel ${
              diagnosticsPanelExpanded ? "expanded" : "collapsed"
            }`}
            aria-label="调试诊断"
            onTouchStart={handleDiagnosticsSwipeStart}
            onTouchEnd={handleDiagnosticsSwipeEnd}
            onTouchCancel={cancelDiagnosticsSwipe}
          >
            <header>
              {diagnosticsPanelCollapsible ? (
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
              <div className="diagnostics-body">
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
              </div>
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
            {draftImages.length > 0 ? (
              <div className="draft-images" aria-label="待发送图片">
                {draftImages.map((image, index) => {
                  const imageLabel = image.referenceLabel ?? `图片${index + 1}`;
                  return (
                    <div className="draft-image" key={image.id}>
                      <button
                        className="draft-image-preview"
                        type="button"
                        title={`${imageLabel} · ${image.name} · ${formatBytes(
                          image.size,
                        )}`}
                        onClick={() =>
                          openImagePreview({
                            src: image.previewUrl,
                            label: imageLabel,
                            name: image.name,
                            size: image.size,
                          })
                        }
                      >
                        <img src={image.previewUrl} alt={image.name} />
                        <span>
                          {imageLabel} · {image.name}
                        </span>
                      </button>
                      <button
                        className="draft-image-remove"
                        type="button"
                        aria-label={`移除${imageLabel} ${image.name}`}
                        onClick={() => removeDraftImage(image.id)}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {composerNotice ? (
              <p className="composer-notice">{composerNotice}</p>
            ) : null}
            <textarea
              ref={composerInputRef}
              rows={2}
              placeholder={
                activeConversationReadOnly
                  ? "归档对话仅浏览，恢复后可继续"
                  : draftImages.length > 0
                    ? "输入图片说明或直接发送"
                    : "输入消息"
              }
              disabled={activeConversationReadOnly}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={sendOnEnter}
              onPaste={handleComposerPaste}
            />
            <div className="turn-options" aria-label="本轮选项">
              <input
                ref={imageInputRef}
                className="file-input-hidden"
                type="file"
                accept={IMAGE_INPUT_ACCEPT}
                multiple
                onChange={handleDraftImageInput}
              />
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
                className="option-chip"
                type="button"
                aria-label="上传图片"
                aria-pressed={false}
                disabled={
                  activeConversationReadOnly || Boolean(pendingMessageId)
                }
                onClick={() => {
                  imageInputRef.current?.click();
                }}
                title="上传本轮图片；桌面端也支持 Ctrl+V 粘贴剪贴板图片。"
              >
                <ImageIcon size={14} />
                图片
              </button>
              <button
                className="option-chip"
                type="button"
                aria-label="引用选中文本到输入框"
                disabled={
                  activeConversationReadOnly ||
                  !selectedMessageText ||
                  Boolean(pendingMessageId)
                }
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (selectedMessageText) {
                    insertSelectedMessageQuote(selectedMessageText.messageId);
                  }
                }}
                title={
                  selectedMessageText
                    ? "将当前选中的消息片段插入输入框"
                    : "先选中消息中的文本片段"
                }
              >
                <TextQuote size={14} />
                引用
              </button>
            </div>
          </div>
          <button
            className="send-button"
            type="button"
            aria-label="发送"
            disabled={
              (!draft.trim() && draftImages.length === 0) ||
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

      {imagePreview ? (
        <div
          className="modal-backdrop image-preview-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setImagePreview(null);
            }
          }}
        >
          <section
            className="image-preview-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="image-preview-title"
          >
            <header>
              <div>
                <p className="eyebrow">Image preview</p>
                <h2 id="image-preview-title">{imagePreview.label}</h2>
                <span>
                  {imagePreview.name} · {formatBytes(imagePreview.size)}
                </span>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="关闭图片预览"
                onClick={() => setImagePreview(null)}
              >
                <X size={18} />
              </button>
            </header>
            <img src={imagePreview.src} alt={imagePreview.name} />
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
              <div className="settings-row compact theme-select">
                <span>
                  <Palette size={16} />
                  主题模式
                </span>
                <CustomSelect
                  className="content-fit"
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
              <div className="settings-row compact theme-select">
                <span>换行规则</span>
                <div className="setting-control-stack content-fit">
                  <CustomSelect
                    className="content-fit"
                    label="换行规则"
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
                </div>
              </div>
              <label className="settings-row quote-template-setting">
                <span>引用格式</span>
                <textarea
                  aria-label="引用格式"
                  placeholder={DEFAULT_MESSAGE_QUOTE_TEMPLATE}
                  value={messageQuoteTemplate}
                  onChange={(event) =>
                    setMessageQuoteTemplate(event.target.value)
                  }
                />
                <small>{"{content}"} 引用消息片段</small>
              </label>
              <div className="settings-row compact theme-select">
                <span>布局模式</span>
                <CustomSelect
                  className="content-fit"
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
              <div className="settings-row compact mobile-status-bar-setting">
                <span>沉浸显示（Android）</span>
                <label className="switch">
                  <input
                    aria-label="沉浸显示（Android）"
                    checked={hideMobileStatusBar}
                    onChange={(event) =>
                      setHideMobileStatusBar(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span />
                </label>
                <small>
                  隐藏系统栏并扩展到刘海/挖孔安全区；仅 Android 应用生效。
                </small>
              </div>
              <div className="settings-row compact summary-policy-setting">
                <span>上下文总结</span>
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
                <label className="inline-number-setting">
                  <span>保留原文</span>
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
                </label>
                <label className="inline-number-setting">
                  <span>自动间隔</span>
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
                </label>
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
              <section
                className="context-profile-workflow-panel"
                aria-label="上下文配置工作流"
              >
                <header>
                  <div>
                    <p className="eyebrow">Workflow</p>
                    <h3>配置建议工作流</h3>
                  </div>
                  <div className="header-actions">
                    <button
                      type="button"
                      onClick={() =>
                        void copyContextProfileWorkflowPrompt("start")
                      }
                    >
                      复制起始说明
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void copyContextProfileWorkflowPrompt("export")
                      }
                    >
                      复制导出说明
                    </button>
                    <button
                      type="button"
                      disabled={
                        !contextProfileWorkflowDraft.standardOutput.trim()
                      }
                      onClick={createContextProfileFromWorkflowOutput}
                    >
                      解析并新建配置
                    </button>
                  </div>
                </header>
                <p className="summary-framework-note">
                  分两步使用：先复制起始说明到任意 agent
                  中自然语言讨论用途、规范、应用场景和助手职责；确认后再复制导出说明，让
                  agent 输出可解析
                  JSON。最后把结果粘贴到这里解析成新的上下文配置。解析只会新建配置，不会覆盖当前配置。
                </p>
                <label className="detail-field context-profile-workflow-output">
                  <span>配置解析区</span>
                  <textarea
                    aria-label="上下文配置解析区"
                    rows={8}
                    placeholder="粘贴包含配置 JSON 的 agent 输出；支持 Markdown json 代码块。"
                    value={contextProfileWorkflowDraft.standardOutput}
                    onChange={(event) =>
                      updateContextProfileWorkflowField(
                        "standardOutput",
                        event.target.value,
                      )
                    }
                  />
                </label>
                {contextProfileWorkflowStatus ? (
                  <p className="backup-message">
                    {contextProfileWorkflowStatus}
                  </p>
                ) : null}
              </section>
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
                            {profile.dimensionOverrides.length} 个维度重载 ·{" "}
                            {normalizeContextProfileSummaryMaxChars(
                              profile.summaryMaxChars,
                            )}{" "}
                            字
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
                    <label className="detail-field">
                      <span>总结字数上限</span>
                      <input
                        aria-label="上下文总结字数上限"
                        max={50000}
                        min={500}
                        type="number"
                        value={normalizeContextProfileSummaryMaxChars(
                          editingContextProfile.summaryMaxChars,
                        )}
                        onChange={(event) =>
                          updateContextProfileSummaryMaxChars(
                            editingContextProfile.id,
                            Number(event.target.value),
                          )
                        }
                      />
                      <small>
                        仅限制该上下文配置生成的 rolling
                        summary；模型配置不参与上下文预算策略。
                      </small>
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
                  <span>图片缓存</span>
                  <strong>
                    {imageCacheStats.count} 张 ·{" "}
                    {formatBytes(imageCacheStats.bytes)}
                  </strong>
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
                <button
                  type="button"
                  disabled={imageCacheStats.count === 0}
                  onClick={clearImageCache}
                >
                  <Trash2 size={16} />
                  清理图片缓存
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

            <section className="model-probe-panel" aria-label="模型探测">
              <header>
                <div>
                  <p className="eyebrow">Model probe</p>
                  <h3>模型探测</h3>
                </div>
                <div className="header-actions">
                  <button type="button" onClick={createModelProbeGroup}>
                    <Plus size={16} />
                    新增探测
                  </button>
                  <button type="button" onClick={resetModelProbeSettings}>
                    <RotateCcw size={16} />
                    还原默认
                  </button>
                </div>
              </header>
              <p className="summary-framework-note">
                模型探测配置独立于助手与已创建模型；规则只生成可能有效的模型
                ID。实际探测直接复用下方“连接与模型”当前连接、API Key
                和协议。若本地仍显示旧规则，点击“还原默认”刷新为当前预设。
              </p>

              <div className="profile-layout model-probe-layout">
                <aside className="profile-directory">
                  <div className="assistant-config-select">
                    <span>当前探测</span>
                    <CustomSelect
                      label="选择探测"
                      value={editingModelProbeGroup?.id ?? ""}
                      options={modelProbeSettings.groups.map((group) => ({
                        value: group.id,
                        label: group.name,
                      }))}
                      onChange={(nextValue) =>
                        setModelProbeSettings((current) => ({
                          ...current,
                          editingGroupId: nextValue,
                        }))
                      }
                    />
                  </div>
                  <div className="assistant-card-list">
                    {modelProbeSettings.groups.map((group, index) => (
                      <div className="sortable-card-row" key={group.id}>
                        <button
                          className={`assistant-card ${
                            group.id === editingModelProbeGroup?.id
                              ? "selected"
                              : ""
                          }`}
                          type="button"
                          onClick={() =>
                            setModelProbeSettings((current) => ({
                              ...current,
                              editingGroupId: group.id,
                            }))
                          }
                        >
                          <span>{group.name}</span>
                          <small>
                            {
                              expandModelProbeSettings(
                                modelProbeSettings,
                                group.id,
                              ).length
                            }{" "}
                            candidates
                          </small>
                        </button>
                        <ReorderControls
                          itemName={`探测 ${group.name}`}
                          isFirst={index === 0}
                          isLast={
                            index === modelProbeSettings.groups.length - 1
                          }
                          onMoveUp={() => moveModelProbeGroup(group.id, -1)}
                          onMoveDown={() => moveModelProbeGroup(group.id, 1)}
                        />
                      </div>
                    ))}
                  </div>
                </aside>

                {editingModelProbeGroup ? (
                  <section className="profile-detail">
                    <header className="config-detail-header">
                      <div className="section-caption">
                        <Search size={16} />
                        <span>探测配置</span>
                      </div>
                      <div className="header-actions">
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() =>
                            deleteModelProbeGroup(editingModelProbeGroup.id)
                          }
                        >
                          <Trash2 size={16} />
                          删除探测
                        </button>
                      </div>
                    </header>
                    <div className="reflected-fields">
                      <label className="detail-field">
                        <span>模型 ID</span>
                        <input
                          aria-label="探测模型 ID"
                          value={modelProbeGroupIdDraft}
                          onChange={(event) =>
                            setModelProbeGroupIdDraft(event.target.value)
                          }
                          onBlur={commitModelProbeGroupIdDraft}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.currentTarget.blur();
                            }
                            if (event.key === "Escape") {
                              setModelProbeGroupIdDraft(
                                editingModelProbeGroup.id,
                              );
                              event.currentTarget.blur();
                            }
                          }}
                        />
                      </label>
                      <label className="detail-field">
                        <span>探测名称</span>
                        <input
                          aria-label="探测名称"
                          value={editingModelProbeGroup.name}
                          onChange={(event) =>
                            updateModelProbeGroup(
                              editingModelProbeGroup.id,
                              (group) => ({
                                ...group,
                                name: event.target.value,
                              }),
                            )
                          }
                        />
                      </label>
                    </div>

                    <section className="model-bindings">
                      <header>
                        <div>
                          <p className="eyebrow">Rules</p>
                          <h3>候选生成规则</h3>
                        </div>
                      </header>
                      <div className="probe-rule-list">
                        {editingModelProbeGroup.rules.map((rule, ruleIndex) => (
                          <article className="probe-rule-card" key={rule.id}>
                            <div className="summary-framework-card-header">
                              <label className="dimension-toggle">
                                <input
                                  aria-label={`启用模型探测规则 ${ruleIndex + 1}`}
                                  checked={rule.enabled}
                                  type="checkbox"
                                  onChange={(event) =>
                                    updateModelProbeRule(
                                      editingModelProbeGroup.id,
                                      rule.id,
                                      (currentRule) => ({
                                        ...currentRule,
                                        enabled: event.target.checked,
                                      }),
                                    )
                                  }
                                />
                                <span>规则 {ruleIndex + 1}</span>
                              </label>
                            </div>
                            <section
                              className="probe-dimension-editor"
                              aria-label={`模型探测规则 ${rule.id} 维度`}
                            >
                              <header>
                                <div>
                                  <p className="eyebrow">Arguments</p>
                                  <h4>版本与后缀段</h4>
                                </div>
                                <div className="probe-dimension-actions">
                                  {rule.dimensions.version === undefined ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        addModelProbeRuleDimension(
                                          editingModelProbeGroup.id,
                                          rule.id,
                                          "version",
                                        )
                                      }
                                    >
                                      添加版本区间
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      addModelProbeRuleDimension(
                                        editingModelProbeGroup.id,
                                        rule.id,
                                        getNextProbeArgKey(rule),
                                      )
                                    }
                                  >
                                    添加后缀段
                                  </button>
                                </div>
                              </header>
                              <div className="probe-dimension-list">
                                {Object.entries(rule.dimensions).length ===
                                0 ? (
                                  <p className="summary-framework-note">
                                    当前规则没有维度，会直接使用模板本身。
                                  </p>
                                ) : null}
                                {Object.entries(rule.dimensions).map(
                                  ([dimensionKey, dimensionValue]) => {
                                    if (
                                      isMinorTenthsDimension(dimensionValue)
                                    ) {
                                      return (
                                        <article
                                          className="probe-dimension-card probe-version-card"
                                          key={dimensionKey}
                                        >
                                          <div className="summary-framework-card-header probe-version-header">
                                            <div className="probe-dimension-title">
                                              <h4>
                                                {formatProbeDimensionLabel(
                                                  dimensionKey,
                                                )}
                                              </h4>
                                            </div>
                                            <div className="probe-card-actions">
                                              <button
                                                type="button"
                                                disabled={
                                                  dimensionKey === "version"
                                                }
                                                onClick={() =>
                                                  deleteModelProbeRuleDimension(
                                                    editingModelProbeGroup.id,
                                                    rule.id,
                                                    dimensionKey,
                                                  )
                                                }
                                              >
                                                删除维度
                                              </button>
                                            </div>
                                            <span className="probe-dimension-note">
                                              大版本 + 小版本区间展开
                                            </span>
                                          </div>
                                          <div className="probe-version-grid">
                                            <label className="detail-field probe-major-field">
                                              <span>大版本列表</span>
                                              <input
                                                aria-label={`${dimensionKey} 大版本列表`}
                                                value={formatModelIdListText(
                                                  dimensionValue.majors,
                                                )}
                                                onChange={(event) =>
                                                  updateModelProbeRuleDimension(
                                                    editingModelProbeGroup.id,
                                                    rule.id,
                                                    dimensionKey,
                                                    {
                                                      ...dimensionValue,
                                                      majors:
                                                        parseModelIdListText(
                                                          event.target.value,
                                                        ),
                                                    },
                                                  )
                                                }
                                              />
                                            </label>
                                            <label className="detail-field number-setting probe-minor-field">
                                              <span>起始小版本</span>
                                              <input
                                                aria-label={`${dimensionKey} 起始小版本`}
                                                min={0}
                                                max={9}
                                                type="number"
                                                value={dimensionValue.from ?? 0}
                                                onChange={(event) =>
                                                  updateModelProbeRuleDimension(
                                                    editingModelProbeGroup.id,
                                                    rule.id,
                                                    dimensionKey,
                                                    {
                                                      ...dimensionValue,
                                                      from: Number(
                                                        event.target.value,
                                                      ),
                                                    },
                                                  )
                                                }
                                              />
                                            </label>
                                            <label className="detail-field number-setting probe-minor-field">
                                              <span>结束小版本</span>
                                              <input
                                                aria-label={`${dimensionKey} 结束小版本`}
                                                min={0}
                                                max={9}
                                                type="number"
                                                value={dimensionValue.to ?? 9}
                                                onChange={(event) =>
                                                  updateModelProbeRuleDimension(
                                                    editingModelProbeGroup.id,
                                                    rule.id,
                                                    dimensionKey,
                                                    {
                                                      ...dimensionValue,
                                                      to: Number(
                                                        event.target.value,
                                                      ),
                                                    },
                                                  )
                                                }
                                              />
                                            </label>
                                          </div>
                                          <small className="probe-version-hint">
                                            例如只写 5，会配合区间生成
                                            5、5.1、5.2；小版本 0 不追加
                                            .0。多个大版本可用空格或逗号分隔。
                                          </small>
                                        </article>
                                      );
                                    }

                                    const values =
                                      flattenProbeDimensionValues(
                                        dimensionValue,
                                      );

                                    return (
                                      <article
                                        className="probe-dimension-card probe-suffix-card"
                                        key={dimensionKey}
                                      >
                                        <div className="summary-framework-card-header probe-suffix-header">
                                          <div className="probe-dimension-title">
                                            <h4>
                                              {formatProbeDimensionLabel(
                                                dimensionKey,
                                              )}
                                            </h4>
                                          </div>
                                          <div className="probe-card-actions">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                updateModelProbeRuleDimension(
                                                  editingModelProbeGroup.id,
                                                  rule.id,
                                                  dimensionKey,
                                                  [...values, ""],
                                                )
                                              }
                                            >
                                              添加值
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                deleteModelProbeRuleDimension(
                                                  editingModelProbeGroup.id,
                                                  rule.id,
                                                  dimensionKey,
                                                )
                                              }
                                            >
                                              删除后缀段
                                            </button>
                                          </div>
                                        </div>
                                        <div className="probe-value-list">
                                          {values.map((value, valueIndex) => (
                                            <label
                                              className="probe-value-row"
                                              key={`${dimensionKey}-${valueIndex}`}
                                            >
                                              <span>词条 {valueIndex + 1}</span>
                                              <input
                                                aria-label={`${dimensionKey} 值 ${valueIndex + 1}`}
                                                placeholder="例如 fast 或 flash-lite；留空表示不追加"
                                                value={value}
                                                onChange={(event) => {
                                                  const nextValues = values.map(
                                                    (candidate, index) =>
                                                      index === valueIndex
                                                        ? event.target.value
                                                        : candidate,
                                                  );
                                                  updateModelProbeRuleDimension(
                                                    editingModelProbeGroup.id,
                                                    rule.id,
                                                    dimensionKey,
                                                    nextValues,
                                                  );
                                                }}
                                              />
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  const nextValues =
                                                    values.filter(
                                                      (_candidate, index) =>
                                                        index !== valueIndex,
                                                    );
                                                  updateModelProbeRuleDimension(
                                                    editingModelProbeGroup.id,
                                                    rule.id,
                                                    dimensionKey,
                                                    nextValues,
                                                  );
                                                }}
                                              >
                                                删除
                                              </button>
                                            </label>
                                          ))}
                                        </div>
                                      </article>
                                    );
                                  },
                                )}
                              </div>
                            </section>
                          </article>
                        ))}
                      </div>
                    </section>

                    <section className="model-probe-preview">
                      <header>
                        <div>
                          <p className="eyebrow">Candidates</p>
                          <h3>候选预览</h3>
                        </div>
                        <button
                          type="button"
                          onClick={runModelProbe}
                          disabled={modelProbeRunning}
                        >
                          <Search size={16} />
                          {modelProbeRunning ? "探测中" : "开始探测"}
                        </button>
                      </header>
                      <div className="probe-candidate-summary">
                        <strong>{modelProbeCandidates.length}</strong>
                        <span>个候选模型。预览只展开规则，不会发送请求。</span>
                      </div>
                      <div className="probe-candidate-list">
                        {modelProbeCandidates.slice(0, 80).map((candidate) => (
                          <code key={candidate.modelId}>
                            {candidate.modelId}
                          </code>
                        ))}
                        {modelProbeCandidates.length > 80 ? (
                          <span>
                            还有 {modelProbeCandidates.length - 80} 个未显示
                          </span>
                        ) : null}
                      </div>
                    </section>

                    <section className="model-probe-results">
                      <header>
                        <div>
                          <p className="eyebrow">Results</p>
                          <h3>探测结果</h3>
                        </div>
                        <strong>
                          {modelProbeSuccessResults.length}/
                          {modelProbeResults.length ||
                            modelProbeCandidates.length}
                        </strong>
                      </header>
                      {modelProbeStatus ? (
                        <p className="backup-message">{modelProbeStatus}</p>
                      ) : null}
                      <div className="probe-result-list">
                        {modelProbeResults.length === 0 ? (
                          <p className="summary-framework-note">
                            尚未执行探测。成功项会提供一键创建模型配置。
                          </p>
                        ) : modelProbeSuccessResults.length === 0 ? (
                          <p className="summary-framework-note">
                            本轮没有探测到可用模型；失败项已忽略，不在列表中显示。
                          </p>
                        ) : (
                          modelProbeSuccessResults.map((result) => (
                            <div
                              className="probe-result-row success"
                              key={result.id}
                            >
                              <span>
                                <strong>{result.modelId}</strong>
                                <small>
                                  {result.protocol} · {result.latencyMs}ms
                                </small>
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  createModelFromProbeResult(result)
                                }
                              >
                                创建模型
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </section>
                  </section>
                ) : null}
              </div>
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
                    <header className="config-detail-header">
                      <div className="section-caption">
                        <Server size={16} />
                        <span>连接配置</span>
                      </div>
                      <div className="header-actions">
                        <label className="compact-toggle">
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
                          <span>启用</span>
                        </label>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => deleteApiProfile(editingApiProfile.id)}
                        >
                          <Trash2 size={16} />
                          删除连接
                        </button>
                      </div>
                    </header>
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
                      <>
                        <header className="config-detail-header compact">
                          <div className="section-caption">
                            <span>当前模型详情</span>
                          </div>
                          <div className="header-actions">
                            <label className="compact-toggle">
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
                              <span>启用</span>
                            </label>
                            <button
                              className="danger-button"
                              type="button"
                              onClick={() =>
                                deleteModel(
                                  editingApiProfile.id,
                                  editingModel.id,
                                )
                              }
                            >
                              <Trash2 size={16} />
                              删除模型
                            </button>
                          </div>
                        </header>
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
                      </>
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
                      description: "用于上下文总结等内置语义任务。",
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
                    <label className="compact-toggle">
                      <input
                        aria-label="启用助手"
                        checked={editingAssistant.enabled}
                        type="checkbox"
                        onChange={(event) =>
                          updateAssistantField(
                            editingAssistant.id,
                            "enabled",
                            event.target.checked,
                          )
                        }
                      />
                      <span>启用</span>
                    </label>
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
                  {assistantFields
                    .filter((field) => field.key !== "enabled")
                    .map((field) => {
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
                            {field.helper ? (
                              <small>{field.helper}</small>
                            ) : null}
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
                            {field.helper ? (
                              <small>{field.helper}</small>
                            ) : null}
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
