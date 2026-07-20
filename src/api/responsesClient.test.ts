import { describe, expect, it, vi } from "vitest";
import type {
  ApiProfile,
  Assistant,
  Conversation,
  LocalBlobRecord,
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

const imageBlob: LocalBlobRecord = {
  id: "blob_1",
  kind: "image",
  mimeType: "image/png",
  name: "sample.png",
  size: 12,
  dataUrl: "data:image/png;base64,QUJD",
  createdAt: "2026-07-13T00:00:00.000Z",
};

const secondImageBlob: LocalBlobRecord = {
  id: "blob_2",
  kind: "image",
  mimeType: "image/jpeg",
  name: "second.jpg",
  size: 34,
  dataUrl: "data:image/jpeg;base64,REVG",
  createdAt: "2026-07-13T00:01:00.000Z",
};

const imageMessage: Message = {
  ...messages[0]!,
  text: "describe",
  imageParts: [
    {
      id: "image_1",
      type: "image",
      blobId: imageBlob.id,
      mimeType: imageBlob.mimeType,
      name: imageBlob.name,
      size: imageBlob.size,
      referenceLabel: "图片1",
    },
  ],
};

const multiImageMessage: Message = {
  ...messages[0]!,
  text: "compare [图片1] and [图片2]",
  imageParts: [
    {
      id: "image_1",
      type: "image",
      blobId: imageBlob.id,
      mimeType: imageBlob.mimeType,
      name: imageBlob.name,
      size: imageBlob.size,
      referenceLabel: "图片1",
    },
    {
      id: "image_2",
      type: "image",
      blobId: secondImageBlob.id,
      mimeType: secondImageBlob.mimeType,
      name: secondImageBlob.name,
      size: secondImageBlob.size,
      referenceLabel: "图片2",
    },
  ],
};

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

const createBrokenStreamResponse = (chunksBeforeError: string[]) => {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        const chunk = chunksBeforeError[index++];
        if (chunk) {
          controller.enqueue(encoder.encode(chunk));
          return;
        }

        controller.error(new Error("simulated connection drop"));
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

  it("retries transient network failures before the request is established", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network down"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output_text: "retry ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const request = requestResponsesChat({
        apiProfile,
        assistant,
        conversation,
        model,
        messages,
        signal: new AbortController().signal,
        stream: false,
      });

      await vi.advanceTimersByTimeAsync(600);
      await expect(request).resolves.toMatchObject({ text: "retry ok" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to non-streaming when a stream disconnects before text arrives", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createBrokenStreamResponse([]))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output_text: "fallback ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestResponsesChat({
      apiProfile,
      assistant,
      conversation,
      model,
      messages,
      signal: new AbortController().signal,
      stream: true,
    });

    expect(result.text).toBe("fallback ok");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stream).toBe(
      true,
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).stream).toBe(
      false,
    );
  });

  it("returns partial text when an established stream disconnects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createBrokenStreamResponse([
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"partial"}\n\n',
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

    expect(result.interrupted).toBe(true);
    expect(result.text).toContain("partial");
    expect(result.text).toContain("网络连接中断");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(["partial"]);
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

  it("combines assistant prompt and context profile instructions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: "context ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestResponsesChat({
      apiProfile,
      assistant,
      conversation,
      model,
      contextInstruction: "profile instruction",
      messages,
      signal: new AbortController().signal,
      stream: false,
    });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).instructions,
    ).toBe("test prompt\n\nprofile instruction");
  });

  it("serializes image parts for Responses requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: "vision ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestResponsesChat({
      apiProfile,
      assistant,
      conversation,
      model,
      messages: [imageMessage],
      blobs: [imageBlob],
      signal: new AbortController().signal,
      stream: false,
    });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).input,
    ).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "describe" },
          {
            type: "input_text",
            text: "附件 [图片1] 对应下面这张图片：sample.png，image/png，12 bytes。",
          },
          {
            type: "input_image",
            image_url: imageBlob.dataUrl,
            detail: "auto",
          },
        ],
      },
    ]);
  });

  it("keeps multiple image references adjacent to their image parts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: "multi vision ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestResponsesChat({
      apiProfile,
      assistant,
      conversation,
      model,
      messages: [multiImageMessage],
      blobs: [imageBlob, secondImageBlob],
      signal: new AbortController().signal,
      stream: false,
    });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).input[0].content,
    ).toEqual([
      {
        type: "input_text",
        text: "compare [图片1] and [图片2]",
      },
      {
        type: "input_text",
        text: "附件 [图片1] 对应下面这张图片：sample.png，image/png，12 bytes。",
      },
      {
        type: "input_image",
        image_url: imageBlob.dataUrl,
        detail: "auto",
      },
      {
        type: "input_text",
        text: "附件 [图片2] 对应下面这张图片：second.jpg，image/jpeg，34 bytes。",
      },
      {
        type: "input_image",
        image_url: secondImageBlob.dataUrl,
        detail: "auto",
      },
    ]);
  });

  it("keeps cleared image references as explicit text placeholders", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: "missing image ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await requestResponsesChat({
      apiProfile,
      assistant,
      conversation,
      model,
      messages: [multiImageMessage],
      blobs: [],
      signal: new AbortController().signal,
      stream: false,
    });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).input,
    ).toEqual([
      {
        role: "user",
        content:
          "compare [图片1] and [图片2]\n" +
          "[图片1：sample.png，image/png，12 bytes；图片缓存已清理，无法随本次请求发送]\n" +
          "[图片2：second.jpg，image/jpeg，34 bytes；图片缓存已清理，无法随本次请求发送]",
      },
    ]);
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

  it("serializes image parts for Chat Completions requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "chat vision ok" } }],
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
      messages: [imageMessage],
      blobs: [imageBlob],
      signal: new AbortController().signal,
      stream: false,
    });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).messages[1],
    ).toEqual({
      role: "user",
      content: [
        { type: "text", text: "describe" },
        {
          type: "text",
          text: "附件 [图片1] 对应下面这张图片：sample.png，image/png，12 bytes。",
        },
        {
          type: "image_url",
          image_url: { url: imageBlob.dataUrl },
        },
      ],
    });
  });

  it("keeps cleared image references as text for Chat Completions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "missing chat image ok" } }],
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
      messages: [multiImageMessage],
      blobs: [],
      signal: new AbortController().signal,
      stream: false,
    });

    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).messages[1],
    ).toEqual({
      role: "user",
      content:
        "compare [图片1] and [图片2]\n" +
        "[图片1：sample.png，image/png，12 bytes；图片缓存已清理，无法随本次请求发送]\n" +
        "[图片2：second.jpg，image/jpeg，34 bytes；图片缓存已清理，无法随本次请求发送]",
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
