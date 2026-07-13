import { describe, expect, it, vi } from "vitest";
import type {
  ApiProfile,
  Assistant,
  Conversation,
  Message,
  ModelDefinition,
} from "../domain";
import { requestResponsesChat } from "./responsesClient";

const apiProfile: ApiProfile = {
  id: "mnapi",
  name: "MNAPI",
  description: "",
  baseUrl: "https://api.mnapi.com/v1",
  apiKey: "test-key",
  protocol: "openai-responses",
  enabled: true,
  models: [],
};

const assistant: Assistant = {
  id: "architect",
  name: "架构助手",
  description: "",
  kind: "chat",
  modelBindings: [],
  prompt: "测试 prompt",
  initialMessage: "",
  enabled: true,
};

const conversation: Conversation = {
  id: "conversation",
  title: "测试",
  summary: "",
  archived: false,
};

const model: ModelDefinition = {
  id: "gpt-5.4-mini",
  name: "gpt-5.4-mini",
  description: "",
  enabled: true,
};

const messages: Message[] = [
  {
    id: "m1",
    conversationId: "conversation",
    role: "user",
    label: "用户",
    text: "你好",
  },
];

const createStreamResponse = (chunks: string[]) => {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    },
  );
};

describe("responsesClient", () => {
  it("parses Responses SSE text deltas and completed usage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createStreamResponse([
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"你"}\n\n',
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"好"}\n\n',
          'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":12,"output_tokens":2,"total_tokens":14,"input_tokens_details":{"cached_tokens":4}}}}\n\n',
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];

    const result = await requestResponsesChat({
      apiProfile,
      assistant,
      conversation,
      model,
      messages,
      signal: new AbortController().signal,
      stream: true,
      onTextDelta: (_delta, fullText) => deltas.push(fullText),
    });

    expect(result.text).toBe("你好");
    expect(result.providerResponseId).toBe("resp_1");
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 2,
      totalTokens: 14,
      cachedInputTokens: 4,
    });
    expect(deltas).toEqual(["你", "你好"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stream).toBe(
      true,
    );
  });

  it("sends non-streaming requests when streaming is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_2",
          output_text: "一次性返回",
          usage: {
            input_tokens: 5,
            output_tokens: 3,
            total_tokens: 8,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestResponsesChat({
      apiProfile,
      assistant,
      conversation,
      model,
      messages,
      signal: new AbortController().signal,
      stream: false,
    });

    expect(result.text).toBe("一次性返回");
    expect(result.usage?.inputTokens).toBe(5);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stream).toBe(
      false,
    );
  });
});
