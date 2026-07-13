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
  stream: boolean;
  onTextDelta?: (delta: string, fullText: string) => void;
};

export type ResponsesChatResult = {
  text: string;
  providerResponseId?: string;
  usage?: ResponseUsage;
};

type UnknownRecord = Record<string, unknown>;
type SseEvent = {
  event?: string;
  data: string;
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const normalizeBaseUrl = (baseUrl: string) =>
  baseUrl.trim().replace(/\/+$/, "");

const readString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

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
    ? `模型已返回响应，但解析器没有找到文本输出。Response ID: ${id}`
    : "模型已返回响应，但解析器没有找到文本输出。";
};

export const extractUsage = (payload: unknown): ResponseUsage | undefined => {
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

const createTextItems = (messages: Message[]) =>
  messages.map((message) => ({
    role: message.role,
    content: message.text,
  }));

const buildResponsesRequestBody = ({
  assistant,
  conversation,
  model,
  messages,
  stream,
}: Pick<
  ResponsesChatRequest,
  "assistant" | "conversation" | "model" | "messages" | "stream"
>) =>
  JSON.stringify({
    model: model.id,
    instructions: assistant.prompt || undefined,
    input: createTextItems(messages),
    tools: model.webSearchEnabled ? [{ type: "web_search" }] : undefined,
    store: false,
    stream,
    metadata: {
      mobilechat_conversation_id: conversation.id,
      mobilechat_assistant_id: assistant.id,
    },
  });

const buildChatCompletionsRequestBody = ({
  assistant,
  model,
  messages,
  stream,
}: Pick<ResponsesChatRequest, "assistant" | "model" | "messages" | "stream">) =>
  JSON.stringify({
    model: model.id,
    messages: [
      ...(assistant.prompt
        ? [{ role: "system", content: assistant.prompt }]
        : []),
      ...createTextItems(messages),
    ],
    stream,
  });

const getProtocolEndpoint = (apiProfile: ApiProfile) =>
  apiProfile.protocol === "openai-chat-completions"
    ? "/chat/completions"
    : "/responses";

const buildRequestContextText = ({
  apiProfile,
  model,
}: Pick<ResponsesChatRequest, "apiProfile" | "model">) =>
  `请求目标：POST ${normalizeBaseUrl(apiProfile.baseUrl)}${getProtocolEndpoint(
    apiProfile,
  )}；协议：${apiProfile.protocol}；模型：${model.id}；联网工具：${
    model.webSearchEnabled ? "on" : "off"
  }。`;

const buildErrorMessage = async (
  response: Response,
  context: Pick<ResponsesChatRequest, "apiProfile" | "model">,
) => {
  const rawBody = await response.text().catch(() => "");
  const contextText = buildRequestContextText(context);
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  const routeHint =
    response.status === 404
      ? " 如果网页端同模型可用，优先确认 Base URL 是否包含 /v1、模型 ID 是否完全一致，并临时关闭联网工具重试。"
      : "";

  if (!rawBody) {
    return `请求失败：HTTP ${response.status}${statusText}。${contextText}${routeHint}`;
  }

  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (isRecord(parsed) && isRecord(parsed.error)) {
      const message = readString(parsed.error.message);
      const type = readString(parsed.error.type);
      const code = readString(parsed.error.code);
      const param = readString(parsed.error.param);
      const details = [
        message ? `message=${message}` : undefined,
        type ? `type=${type}` : undefined,
        code ? `code=${code}` : undefined,
        param ? `param=${param}` : undefined,
      ].filter(Boolean);
      if (message) {
        return `请求失败：${message}。${contextText}${routeHint}`;
      }
      if (details.length > 0) {
        return `请求失败：HTTP ${response.status}${statusText}；${details.join(
          "；",
        )}。${contextText}${routeHint}`;
      }
    }
  } catch {
    // fall through to bounded text below
  }

  return `请求失败：HTTP ${response.status}${statusText}；${rawBody.slice(
    0,
    400,
  )}。${contextText}${routeHint}`;
};

const fetchProtocolEndpoint = async ({
  apiProfile,
  apiKey,
  body,
  signal,
}: {
  apiProfile: ApiProfile;
  apiKey: string;
  body: string;
  signal: AbortSignal;
}) =>
  fetch(
    `${normalizeBaseUrl(apiProfile.baseUrl)}${getProtocolEndpoint(apiProfile)}`,
    {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream, application/json",
        "Content-Type": "application/json",
      },
      body,
    },
  ).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new Error(
      "网络请求失败。若 API 地址正确且 key 有效，常见原因是中转站没有开放浏览器 CORS；静态页直连会被浏览器拦截。",
    );
  });

const parseSseBlock = (block: string): SseEvent | undefined => {
  const lines = block.split(/\r?\n/);
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
      continue;
    }
  }

  const data = dataLines.length > 0 ? dataLines.join("\n") : block.trim();
  return data ? { event, data } : undefined;
};

const parseStreamJson = (event: SseEvent): unknown | undefined => {
  if (event.data === "[DONE]") {
    return undefined;
  }

  try {
    return JSON.parse(event.data) as unknown;
  } catch {
    return undefined;
  }
};

const getResponsePayload = (payload: unknown): unknown => {
  if (!isRecord(payload)) {
    return payload;
  }
  return isRecord(payload.response) ? payload.response : payload;
};

const extractStreamDelta = (payload: unknown): string | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }

  const type = readString(payload.type);
  if (
    type === "response.output_text.delta" ||
    type === "response.refusal.delta"
  ) {
    return readString(payload.delta);
  }

  if (Array.isArray(payload.choices)) {
    const firstChoice = payload.choices[0];
    if (isRecord(firstChoice) && isRecord(firstChoice.delta)) {
      return readString(firstChoice.delta.content);
    }
  }

  return undefined;
};

const extractStreamError = (payload: unknown): string | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }

  const type = readString(payload.type);
  if (type !== "error" && type !== "response.failed") {
    return undefined;
  }

  if (isRecord(payload.error)) {
    return readString(payload.error.message) ?? "流式响应返回错误。";
  }
  if (isRecord(payload.response) && isRecord(payload.response.error)) {
    return readString(payload.response.error.message) ?? "流式响应返回错误。";
  }
  return readString(payload.message) ?? "流式响应返回错误。";
};

const readResponsesStream = async (
  response: Response,
  onTextDelta?: (delta: string, fullText: string) => void,
): Promise<ResponsesChatResult> => {
  if (!response.body) {
    throw new Error("当前浏览器没有返回可读取的流式响应体。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let providerResponseId: string | undefined;
  let finalPayload: unknown | undefined;

  const handleEvent = (event: SseEvent) => {
    const payload = parseStreamJson(event);
    if (!payload) {
      return;
    }

    const errorMessage = extractStreamError(payload);
    if (errorMessage || event.event === "error") {
      throw new Error(errorMessage ?? "流式响应返回错误。");
    }

    const responsePayload = getResponsePayload(payload);
    if (isRecord(responsePayload)) {
      providerResponseId ??= readString(responsePayload.id);
    }

    const delta = extractStreamDelta(payload);
    if (delta) {
      text += delta;
      onTextDelta?.(delta, text);
    }

    if (isRecord(payload)) {
      if (
        payload.type === "response.completed" ||
        payload.type === "response.failed" ||
        payload.type === "response.incomplete"
      ) {
        finalPayload = responsePayload;
      }
      if (
        !readString(payload.type) &&
        (readString(payload.output_text) ||
          Array.isArray(payload.output) ||
          Array.isArray(payload.choices))
      ) {
        finalPayload = payload;
      }
    }
  };

  const processBuffer = (flush = false) => {
    let separatorIndex = buffer.search(/\r?\n\r?\n/);
    while (separatorIndex !== -1) {
      const block = buffer.slice(0, separatorIndex);
      const separator = buffer.match(/\r?\n\r?\n/)?.[0] ?? "\n\n";
      buffer = buffer.slice(separatorIndex + separator.length);
      const event = parseSseBlock(block);
      if (event) {
        handleEvent(event);
      }
      separatorIndex = buffer.search(/\r?\n\r?\n/);
    }

    if (flush && buffer.trim()) {
      const event = parseSseBlock(buffer);
      buffer = "";
      if (event) {
        handleEvent(event);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    processBuffer();
  }
  buffer += decoder.decode();
  processBuffer(true);

  const fallbackText = finalPayload ? extractResponseText(finalPayload) : "";
  return {
    text: text.trim() ? text : fallbackText,
    providerResponseId,
    usage: extractUsage(finalPayload),
  };
};

export const requestResponsesChat = async ({
  apiProfile,
  assistant,
  conversation,
  model,
  messages,
  signal,
  stream,
  onTextDelta,
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
  if (
    apiProfile.protocol === "openai-chat-completions" &&
    model.webSearchEnabled
  ) {
    throw new Error(
      `Profile「${apiProfile.name}」当前使用 Chat Completions 协议，首版尚未定义该协议的联网工具格式。请先关闭模型「${model.name}」的联网工具后重试。`,
    );
  }

  const requestBody =
    apiProfile.protocol === "openai-chat-completions"
      ? buildChatCompletionsRequestBody({
          assistant,
          model,
          messages,
          stream,
        })
      : buildResponsesRequestBody({
          assistant,
          conversation,
          model,
          messages,
          stream,
        });

  const response = await fetchProtocolEndpoint({
    apiProfile,
    apiKey,
    signal,
    body: requestBody,
  });

  if (!response.ok) {
    throw new Error(await buildErrorMessage(response, { apiProfile, model }));
  }

  if (stream) {
    const contentType = response.headers.get("content-type")?.toLowerCase();
    if (contentType?.includes("application/json")) {
      const payload = (await response.json()) as unknown;
      return {
        text: extractResponseText(payload),
        providerResponseId: isRecord(payload)
          ? readString(payload.id)
          : undefined,
        usage: extractUsage(payload),
      };
    }

    return readResponsesStream(response, onTextDelta);
  }

  const payload = (await response.json()) as unknown;
  return {
    text: extractResponseText(payload),
    providerResponseId: isRecord(payload) ? readString(payload.id) : undefined,
    usage: extractUsage(payload),
  };
};
