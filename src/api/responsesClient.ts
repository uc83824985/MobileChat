import type {
  ApiProfile,
  Assistant,
  Conversation,
  LocalBlobRecord,
  Message,
  MessageImagePart,
  ModelDefinition,
  ResponseUsage,
} from "../domain";

export type ResponsesChatRequest = {
  apiProfile: ApiProfile;
  assistant: Assistant;
  conversation: Conversation;
  model: ModelDefinition;
  contextInstruction?: string;
  messages: Message[];
  blobs?: LocalBlobRecord[];
  signal: AbortSignal;
  stream: boolean;
  webSearchEnabled?: boolean;
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

const createBlobMap = (blobs?: LocalBlobRecord[]) =>
  new Map((blobs ?? []).map((blob) => [blob.id, blob]));

type AvailableImage = {
  part: MessageImagePart;
  blob: LocalBlobRecord;
  index: number;
};

const formatImagePlaceholder = (image: {
  name: string;
  mimeType: string;
  size: number;
  referenceLabel?: string;
}) =>
  `[${image.referenceLabel ?? "图片"}：${image.name || "image"}，${
    image.mimeType || "image/*"
  }，${image.size || 0} bytes；图片缓存已清理，无法随本次请求发送]`;

const createAvailableImages = (
  imageParts: MessageImagePart[],
  blobMap: Map<string, LocalBlobRecord>,
): AvailableImage[] =>
  imageParts.flatMap((part, index) => {
    const blob = blobMap.get(part.blobId);
    return blob ? [{ part, blob, index }] : [];
  });

const formatAvailableImageReference = ({ part, blob, index }: AvailableImage) =>
  `附件 [${part.referenceLabel ?? `图片${index + 1}`}] 对应下面这张图片：${
    part.name || blob.name || "image"
  }，${part.mimeType || blob.mimeType || "image/*"}，${
    part.size || blob.size || 0
  } bytes。`;

const buildTextWithMissingImagePlaceholders = (
  message: Message,
  blobMap: Map<string, LocalBlobRecord>,
) => {
  const missingImages = (message.imageParts ?? []).filter(
    (part) => !blobMap.has(part.blobId),
  );
  const missingText = missingImages.map(formatImagePlaceholder).join("\n");
  const text = message.text.trim()
    ? message.text
    : (message.imageParts?.length ?? 0) > 0
      ? "用户发送了图片。"
      : message.text;

  return [text, missingText].filter(Boolean).join("\n");
};

const createResponsesItems = (
  messages: Message[],
  blobs?: LocalBlobRecord[],
) => {
  const blobMap = createBlobMap(blobs);

  return messages.map((message) => {
    const imageParts =
      message.role === "user" ? (message.imageParts ?? []) : [];
    const availableImages = createAvailableImages(imageParts, blobMap);

    if (availableImages.length === 0) {
      return {
        role: message.role,
        content: buildTextWithMissingImagePlaceholders(message, blobMap),
      };
    }

    return {
      role: message.role,
      content: [
        {
          type: "input_text",
          text: buildTextWithMissingImagePlaceholders(message, blobMap),
        },
        ...availableImages.flatMap((availableImage) => [
          {
            type: "input_text",
            text: formatAvailableImageReference(availableImage),
          },
          {
            type: "input_image",
            image_url: availableImage.blob.dataUrl,
            detail: "auto",
          },
        ]),
      ],
    };
  });
};

const createChatCompletionItems = (
  messages: Message[],
  blobs?: LocalBlobRecord[],
) => {
  const blobMap = createBlobMap(blobs);

  return messages.map((message) => {
    const imageParts =
      message.role === "user" ? (message.imageParts ?? []) : [];
    const availableImages = createAvailableImages(imageParts, blobMap);

    if (availableImages.length === 0) {
      return {
        role: message.role,
        content: buildTextWithMissingImagePlaceholders(message, blobMap),
      };
    }

    return {
      role: message.role,
      content: [
        {
          type: "text",
          text: buildTextWithMissingImagePlaceholders(message, blobMap),
        },
        ...availableImages.flatMap((availableImage) => [
          {
            type: "text",
            text: formatAvailableImageReference(availableImage),
          },
          {
            type: "image_url",
            image_url: {
              url: availableImage.blob.dataUrl,
            },
          },
        ]),
      ],
    };
  });
};

const combineInstructions = (
  assistantPrompt?: string,
  contextInstruction?: string,
) =>
  [assistantPrompt?.trim(), contextInstruction?.trim()]
    .filter(Boolean)
    .join("\n\n");

const buildResponsesRequestBody = ({
  assistant,
  contextInstruction,
  model,
  messages,
  blobs,
  stream,
  webSearchEnabled,
}: Pick<
  ResponsesChatRequest,
  | "assistant"
  | "contextInstruction"
  | "model"
  | "messages"
  | "blobs"
  | "stream"
  | "webSearchEnabled"
>) =>
  JSON.stringify({
    model: model.id,
    instructions:
      combineInstructions(assistant.prompt, contextInstruction) || undefined,
    input: createResponsesItems(messages, blobs),
    tools: webSearchEnabled ? [{ type: "web_search" }] : undefined,
    store: false,
    stream,
  });

const buildChatCompletionsRequestBody = ({
  assistant,
  contextInstruction,
  model,
  messages,
  blobs,
  stream,
  webSearchEnabled,
}: Pick<
  ResponsesChatRequest,
  | "assistant"
  | "contextInstruction"
  | "model"
  | "messages"
  | "blobs"
  | "stream"
  | "webSearchEnabled"
>) =>
  JSON.stringify({
    model: model.id,
    web_search_options: webSearchEnabled ? {} : undefined,
    messages: [
      ...(combineInstructions(assistant.prompt, contextInstruction)
        ? [
            {
              role: "system",
              content: combineInstructions(
                assistant.prompt,
                contextInstruction,
              ),
            },
          ]
        : []),
      ...createChatCompletionItems(messages, blobs),
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
  webSearchEnabled,
}: Pick<ResponsesChatRequest, "apiProfile" | "model" | "webSearchEnabled">) =>
  `请求目标：POST ${normalizeBaseUrl(apiProfile.baseUrl)}${getProtocolEndpoint(
    apiProfile,
  )}；协议：${apiProfile.protocol}；模型：${model.id}；联网工具：${
    webSearchEnabled ? "on" : "off"
  }。`;

const buildErrorMessage = async (
  response: Response,
  context: Pick<
    ResponsesChatRequest,
    "apiProfile" | "model" | "webSearchEnabled"
  >,
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
  contextInstruction,
  model,
  messages,
  blobs,
  signal,
  stream,
  webSearchEnabled = false,
  onTextDelta,
}: ResponsesChatRequest): Promise<ResponsesChatResult> => {
  const baseUrl = normalizeBaseUrl(apiProfile.baseUrl);
  const apiKey = apiProfile.apiKey.trim();

  if (!apiProfile.enabled) {
    throw new Error(`连接「${apiProfile.name}」未启用。`);
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

  const requestBody =
    apiProfile.protocol === "openai-chat-completions"
      ? buildChatCompletionsRequestBody({
          assistant,
          contextInstruction,
          model,
          messages,
          blobs,
          stream,
          webSearchEnabled,
        })
      : buildResponsesRequestBody({
          assistant,
          contextInstruction,
          model,
          messages,
          blobs,
          stream,
          webSearchEnabled,
        });

  const response = await fetchProtocolEndpoint({
    apiProfile,
    apiKey,
    signal,
    body: requestBody,
  });

  if (!response.ok) {
    throw new Error(
      await buildErrorMessage(response, {
        apiProfile,
        model,
        webSearchEnabled,
      }),
    );
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
