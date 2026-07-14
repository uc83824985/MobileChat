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
  id: "test-profile",
  name: "Test Profile",
  description: "",
  baseUrl: "https://api.example.test/v1",
  apiKey: "test-key",
  protocol: "openai-responses",
  enabled: true,
  models: [],
};

const assistant: Assistant = {
  id: "architect",
  name: "Assistant",
  description: "",
  kind: "chat",
  modelBindings: [],
  prompt: "test prompt",
  initialMessage: "",
  enabled: true,
};

const conversation: Conversation = {
  id: "conversation",
  title: "Test",
  summary: "",
  archived: false,
};

const model: ModelDefinition = {
  id: "test-model",
  name: "test-model",
  description: "",
  enabled: true,
};

const messages: Message[] = [
  {
    id: "m1",
    conversationId: "conversation",
    role: "user",
    label: "User",
    text: "hello",
    createdAt: "2026-07-13T00:00:00.000Z",
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
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hel"}\n\n',
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"lo"}\n\n',
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

    expect(result.text).toBe("hello");
    expect(result.providerResponseId).toBe("resp_1");
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 2,
      totalTokens: 14,
      cachedInputTokens: 4,
    });
    expect(deltas).toEqual(["hel", "hello"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stream).toBe(
      true,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).tools).toBe(
      undefined,
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).metadata,
    ).toBe(undefined);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Accept: "text/event-stream, application/json",
    });
  });

  it("adds the web_search tool only when the request enables web access", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_web",
          output_text: "web response",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestResponsesChat({
      apiProfile,
      assistant,
      conversation,
      model: {
        ...model,
        id: "web-model",
        name: "web-model",
      },
      messages,
      signal: new AbortController().signal,
      stream: false,
      webSearchEnabled: true,
    });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      model: "web-model",
      tools: [{ type: "web_search" }],
    });
  });

  it("falls back to JSON parsing when a stream request is buffered by the provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_json_stream",
          output_text: "buffered response",
          usage: {
            input_tokens: 9,
            output_tokens: 2,
            total_tokens: 11,
            input_tokens_details: { cached_tokens: 0 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
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

    expect(result.text).toBe("buffered response");
    expect(result.providerResponseId).toBe("resp_json_stream");
    expect(result.usage?.cachedInputTokens).toBe(0);
    expect(deltas).toEqual([]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stream).toBe(
      true,
    );
  });

  it("sends non-streaming requests when streaming is disabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_2",
          output_text: "single response",
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

    expect(result.text).toBe("single response");
    expect(result.usage?.inputTokens).toBe(5);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stream).toBe(
      false,
    );
  });

  it("supports OpenAI-compatible Chat Completions profiles", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_1",
          choices: [
            {
              message: {
                role: "assistant",
                content: "chat response",
              },
            },
          ],
          usage: {
            prompt_tokens: 6,
            completion_tokens: 2,
            total_tokens: 8,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestResponsesChat({
      apiProfile: {
        ...apiProfile,
        protocol: "openai-chat-completions",
      },
      assistant,
      conversation,
      model,
      messages,
      signal: new AbortController().signal,
      stream: false,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/v1/chat/completions",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      model: "test-model",
      messages: [
        { role: "system", content: "test prompt" },
        { role: "user", content: "hello" },
      ],
      stream: false,
    });
    expect(result.text).toBe("chat response");
    expect(result.usage).toEqual({
      inputTokens: 6,
      outputTokens: 2,
      totalTokens: 8,
      cachedInputTokens: undefined,
    });
  });

  it("uses web_search_options for Chat Completions web search routes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chatcmpl_search",
          choices: [{ message: { content: "searched" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestResponsesChat({
      apiProfile: {
        ...apiProfile,
        protocol: "openai-chat-completions",
      },
      assistant,
      conversation,
      model,
      messages,
      signal: new AbortController().signal,
      stream: false,
      webSearchEnabled: true,
    });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      model: "test-model",
      web_search_options: {},
    });
  });

  it("includes route context when a provider returns an opaque error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: "",
              type: "rix_api_error",
              param: "",
              code: "bad_response_status_code",
            },
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      requestResponsesChat({
        apiProfile,
        assistant,
        conversation,
        model,
        messages,
        signal: new AbortController().signal,
        stream: true,
        webSearchEnabled: true,
      }),
    ).rejects.toThrow(
      /POST https:\/\/api\.example\.test\/v1\/responses.*协议：openai-responses.*模型：test-model.*联网工具：on.*\/v1/,
    );
  });
});
