import type {
  ApiProfile,
  Assistant,
  Conversation,
  Message,
  ModelDefinition,
  ResponseUsage,
} from "../domain";

export type ResponsesChatRequest = {
  apiProfile: ApiProfile;
  assistant: Assistant;
  conversation: Conversation;
  model: ModelDefinition;
  messages: Message[];
  signal: AbortSignal;
};

export type ResponsesChatResult = {
  text: string;
  providerResponseId?: string;
  usage?: ResponseUsage;
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const normalizeBaseUrl = (baseUrl: string) =>
  baseUrl.trim().replace(/\/+$/, "");

const readString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const collectTextFragments = (value: unknown, fragments: string[]) => {
  if (!value) {
    return;
  }

  if (typeof value === "string") {
    fragments.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFragments(item, fragments);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const type = readString(value.type);
  if (
    type === "output_text" ||
    type === "input_text" ||
    type === "text" ||
    type === "refusal"
  ) {
    const text =
      readString(value.text) ??
      readString(value.output_text) ??
      readString(value.refusal);
    if (text) {
      fragments.push(text);
      return;
    }
  }

  collectTextFragments(value.content, fragments);
  collectTextFragments(value.message, fragments);
};

export const extractResponseText = (payload: unknown): string => {
  if (!isRecord(payload)) {
    return "模型返回了非 JSON 响应。";
  }

  const outputText = readString(payload.output_text);
  if (outputText?.trim()) {
    return outputText.trim();
  }

  const fragments: string[] = [];
  collectTextFragments(payload.output, fragments);

  const firstChoice = Array.isArray(payload.choices)
    ? payload.choices[0]
    : undefined;
  collectTextFragments(firstChoice, fragments);

  const text = fragments.map((fragment) => fragment.trim()).filter(Boolean);
  if (text.length > 0) {
    return text.join("\n\n");
  }

  const id = readString(payload.id);
  return id
    ? `模型已返回响应，但首版解析器没有找到文本输出。Response ID: ${id}`
    : "模型已返回响应，但首版解析器没有找到文本输出。";
};

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const extractUsage = (payload: unknown): ResponseUsage | undefined => {
  if (!isRecord(payload) || !isRecord(payload.usage)) {
    return undefined;
  }

  const usage = payload.usage;
  const inputTokens =
    readNumber(usage.input_tokens) ?? readNumber(usage.prompt_tokens);
  const outputTokens =
    readNumber(usage.output_tokens) ?? readNumber(usage.completion_tokens);
  const totalTokens = readNumber(usage.total_tokens);

  let cachedInputTokens: number | undefined;
  if (isRecord(usage.input_tokens_details)) {
    cachedInputTokens = readNumber(usage.input_tokens_details.cached_tokens);
  }
  if (isRecord(usage.prompt_tokens_details)) {
    cachedInputTokens ??= readNumber(usage.prompt_tokens_details.cached_tokens);
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
  };
};

const createInputItems = (messages: Message[]) =>
  messages.map((message) => ({
    role: message.role,
    content: message.text,
  }));

const buildErrorMessage = async (response: Response) => {
  const rawBody = await response.text().catch(() => "");

  if (!rawBody) {
    return `请求失败：HTTP ${response.status} ${response.statusText}`;
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (isRecord(parsed) && isRecord(parsed.error)) {
      const message = readString(parsed.error.message);
      if (message) {
        return `请求失败：${message}`;
      }
    }
  } catch {
    // fall through to bounded text below
  }

  return `请求失败：HTTP ${response.status} ${response.statusText}；${rawBody.slice(
    0,
    400,
  )}`;
};

export const requestResponsesChat = async ({
  apiProfile,
  assistant,
  conversation,
  model,
  messages,
  signal,
}: ResponsesChatRequest): Promise<ResponsesChatResult> => {
  const baseUrl = normalizeBaseUrl(apiProfile.baseUrl);
  const apiKey = apiProfile.apiKey.trim();

  if (!apiProfile.enabled) {
    throw new Error(`API Profile「${apiProfile.name}」未启用。`);
  }
  if (!model.enabled) {
    throw new Error(`模型「${model.name}」未启用。`);
  }
  if (!baseUrl) {
    throw new Error(`请先在设置页为「${apiProfile.name}」填写 API 请求地址。`);
  }
  if (!apiKey) {
    throw new Error(`请先在设置页为「${apiProfile.name}」填写 API key。`);
  }

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model.id,
      instructions: assistant.prompt || undefined,
      input: createInputItems(messages),
      store: false,
      stream: false,
      metadata: {
        mobilechat_conversation_id: conversation.id,
        mobilechat_assistant_id: assistant.id,
      },
    }),
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new Error(
      "网络请求失败。若 API 地址正确且 key 有效，常见原因是中转站没有开放浏览器 CORS；静态页直连会被浏览器拦截。",
    );
  });

  if (!response.ok) {
    throw new Error(await buildErrorMessage(response));
  }

  const payload = (await response.json()) as unknown;
  return {
    text: extractResponseText(payload),
    providerResponseId: isRecord(payload) ? readString(payload.id) : undefined,
    usage: extractUsage(payload),
  };
};
