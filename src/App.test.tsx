import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { deleteMobileChatDb } from "./persistence/mobileChatDb";

describe("App", () => {
  beforeEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete window.MobileChatAndroid;
    vi.stubGlobal("indexedDB", new IDBFactory());
    window.localStorage.clear();
    await deleteMobileChatDb();
  });

  const configureApiProfile = ({
    baseUrl = "https://api.example.test/v1",
    apiKey = "",
    createModel = true,
  } = {}) => {
    fireEvent.click(screen.getByText("设置"));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: baseUrl },
    });
    if (apiKey) {
      fireEvent.change(screen.getByLabelText("API Key"), {
        target: { value: apiKey },
      });
    }
    if (createModel) {
      fireEvent.click(screen.getByText("新增模型"));
      fireEvent.click(screen.getByLabelText("允许模型 默认连接 new-model-1"));
    }
    fireEvent.click(screen.getByLabelText("关闭设置"));
  };

  const getCustomSelect = (label: string) =>
    screen.getByRole("combobox", { name: label });

  const expectCustomSelectValue = (label: string, value: string) => {
    expect(getCustomSelect(label)).toHaveTextContent(value);
  };

  const chooseCustomSelectOption = (label: string, option: string) => {
    fireEvent.click(getCustomSelect(label));
    fireEvent.click(screen.getByRole("option", { name: option }));
  };

  it("renders the mobile chat shell", () => {
    render(<App />);

    expect(
      screen.getByRole("region", { name: "当前对话" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "对话列表" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("调试诊断")).toBeInTheDocument();

    fireEvent.click(getCustomSelect("选择助手"));
    expect(
      screen.getByRole("option", { name: "默认助手" }),
    ).toBeInTheDocument();
  });

  it("uses mirrored UI preferences before IndexedDB hydration", () => {
    window.localStorage.setItem(
      "mobilechat:ui-preferences",
      JSON.stringify({ themeMode: "dark", layoutMode: "mobile" }),
    );

    render(<App />);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("main")).toHaveClass("mobile-layout");
  });

  it("expands and collapses diagnostics with vertical swipes", () => {
    window.localStorage.setItem(
      "mobilechat:ui-preferences",
      JSON.stringify({ layoutMode: "mobile" }),
    );

    render(<App />);

    const diagnosticsPanel = screen.getByLabelText("调试诊断");
    expect(diagnosticsPanel).toHaveClass("collapsed");

    fireEvent.touchStart(diagnosticsPanel, {
      touches: [{ clientX: 160, clientY: 500 }],
    });
    fireEvent.touchEnd(diagnosticsPanel, {
      changedTouches: [{ clientX: 160, clientY: 430 }],
    });

    expect(diagnosticsPanel).toHaveClass("expanded");

    const diagnosticsBody = diagnosticsPanel.querySelector(
      ".diagnostics-body",
    ) as HTMLElement;
    diagnosticsBody.scrollTop = 0;

    fireEvent.touchStart(diagnosticsBody, {
      touches: [{ clientX: 160, clientY: 430 }],
    });
    fireEvent.touchEnd(diagnosticsBody, {
      changedTouches: [{ clientX: 160, clientY: 500 }],
    });

    expect(diagnosticsPanel).toHaveClass("collapsed");
  });

  it("edits the active conversation title from the chat header", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("新建对话"));
    fireEvent.click(screen.getByLabelText("编辑标题"));
    fireEvent.change(screen.getByLabelText("对话标题"), {
      target: { value: "自定义标题" },
    });
    fireEvent.click(screen.getByLabelText("保存标题"));

    expect(screen.getAllByText("自定义标题")).toHaveLength(2);
  });

  it("creates a conversation and reports missing API key for the real request loop", async () => {
    render(<App />);
    configureApiProfile();

    fireEvent.click(screen.getByLabelText("新建对话"));
    expect(screen.getAllByText("新对话 2")).toHaveLength(2);
    expect(screen.getByText("开始一个新对话")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "测试发送" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    expect(screen.getByText("测试发送")).toBeInTheDocument();
    expect(
      await screen.findByText(/请先在设置页.*API key/),
    ).toBeInTheDocument();
  });

  it("supports multiline composer shortcuts and configurable submit mode", () => {
    render(<App />);
    configureApiProfile();

    const composer = screen.getByPlaceholderText(
      "输入消息",
    ) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "alphaomega" } });
    composer.setSelectionRange(5, 5);
    fireEvent.keyDown(composer, { key: "j", ctrlKey: true });
    expect(composer).toHaveValue("alpha\nomega");

    fireEvent.click(screen.getByText("设置"));
    chooseCustomSelectOption("换行规则", "Enter 换行");
    fireEvent.click(screen.getByLabelText("关闭设置"));

    fireEvent.change(composer, { target: { value: "键盘发送" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    expect(
      screen.queryByText("键盘发送", { selector: ".message p" }),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(composer, { key: "Enter", ctrlKey: true });
    expect(
      screen.getByText("键盘发送", { selector: ".message p" }),
    ).toBeInTheDocument();
  });

  it("quotes only the selected message fragment into the composer", async () => {
    render(<App />);
    configureApiProfile();

    fireEvent.click(screen.getByText("设置"));
    expect(screen.getByLabelText("引用格式")).toHaveValue("“{content}”：");
    fireEvent.change(screen.getByLabelText("引用格式"), {
      target: { value: "> {content}" },
    });
    fireEvent.click(screen.getByLabelText("关闭设置"));

    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "alpha critical beta" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    const userText = await screen.findByText("alpha critical beta", {
      selector: ".message.user [data-message-text]",
    });
    const userMessage = userText.closest("article") as HTMLElement;
    const userQuoteButton = within(userMessage).getByRole("button", {
      name: "引用选中文本",
    });
    const composerQuoteButton = screen.getByRole("button", {
      name: "引用选中文本到输入框",
    });
    expect(userQuoteButton).toBeDisabled();
    expect(composerQuoteButton).toBeDisabled();

    const textNode = userText.firstChild;
    expect(textNode).toBeTruthy();
    const range = document.createRange();
    range.setStart(textNode as Node, "alpha ".length);
    range.setEnd(textNode as Node, "alpha critical".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.mouseUp(screen.getByLabelText("消息列表"));

    expect(userQuoteButton).toBeEnabled();
    expect(composerQuoteButton).toBeEnabled();
    fireEvent.mouseDown(composerQuoteButton);
    fireEvent.click(composerQuoteButton);

    expect(screen.getByPlaceholderText("输入消息")).toHaveValue("> critical");
  });

  it("sends a debug TTS replace request for a message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    configureApiProfile();

    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "朗读测试" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    const userText = await screen.findByText("朗读测试", {
      selector: ".message.user [data-message-text]",
    });
    const userMessage = userText.closest("article") as HTMLElement;
    fireEvent.click(
      within(userMessage).getByRole("button", { name: "朗读消息" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:8765/tts_speak",
    );
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)),
    ).toMatchObject({
      text: "朗读测试",
      mode: "replace",
      meta: {
        source: "mobile-chat",
        role: "user",
      },
    });
  });

  it("shows only cache usage after a buffered streaming response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "resp_cache",
            output_text: "usage ok",
            usage: {
              input_tokens: 5,
              output_tokens: 2,
              total_tokens: 7,
              input_tokens_details: { cached_tokens: 0 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(<App />);
    configureApiProfile({ apiKey: "test-key" });

    fireEvent.click(screen.getByLabelText("新建对话"));
    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "usage test" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    expect(screen.getByText("正在等待流式输出…")).toBeInTheDocument();
    expect(await screen.findByText("usage ok")).toBeInTheDocument();
    expect(screen.getByText("cache 0/5")).toBeInTheDocument();
    expect(screen.getByText(/用时 /)).toBeInTheDocument();
    expect(screen.queryByText(/in 5 \/ out/)).not.toBeInTheDocument();
  });

  it("renders streamed text as append-only chunks", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hello "}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"world"}\n\n',
          ),
        );
        controller.enqueue(
          encoder.encode(
            'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_stream","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}\n\n',
          ),
        );
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
      ),
    );
    render(<App />);
    configureApiProfile({ apiKey: "test-key" });

    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "stream chunks" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    const messageList = screen.getByLabelText("消息列表");
    await waitFor(() => expect(messageList).toHaveTextContent("hello world"));
    const assistantMessages = messageList.querySelectorAll(
      "article.message.assistant",
    );
    const assistantMessage = assistantMessages[
      assistantMessages.length - 1
    ] as HTMLElement;
    expect(
      assistantMessage.querySelectorAll("[data-message-text] span"),
    ).toHaveLength(2);
  });

  it("marks cache usage as not returned when the relay omits cached tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "resp_no_cache_detail",
            output_text: "no cache detail",
            usage: {
              prompt_tokens: 989,
              completion_tokens: 4,
              total_tokens: 993,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(<App />);
    configureApiProfile({ apiKey: "test-key" });

    fireEvent.click(screen.getByLabelText("新建对话"));
    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "cache detail test" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    expect(await screen.findByText("no cache detail")).toBeInTheDocument();
    expect(screen.getByText("cache 未返回/989")).toBeInTheDocument();
  });

  it("generates and previews a debug context summary without adding a visible message", async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const inputText = Array.isArray(body.input)
        ? body.input
            .map((item: { content?: string }) => item.content)
            .join("\n")
        : "";
      return Promise.resolve(
        new Response(
          JSON.stringify({
            output_text: inputText.includes("请为 MobileChat 当前单个对话")
              ? "SUMMARY RESULT"
              : "chat response",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    configureApiProfile();

    expect(screen.getByText("显示总结")).toBeDisabled();

    for (let index = 0; index < 1; index += 1) {
      fireEvent.change(screen.getByPlaceholderText("输入消息"), {
        target: { value: `summary seed ${index}` },
      });
      fireEvent.click(screen.getByLabelText("发送"));
      expect(
        await screen.findByText(`summary seed ${index}`),
      ).toBeInTheDocument();
    }

    configureApiProfile({ apiKey: "test-key", createModel: false });

    fireEvent.click(screen.getByText("总结上下文"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const summaryRequestBody = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    );
    const summaryRequestText = Array.isArray(summaryRequestBody.input)
      ? summaryRequestBody.input
          .map((item: { content?: string }) => item.content)
          .join("\n")
      : "";
    expect(summaryRequestText).toContain(
      "对话标题和列表摘要只作为定位参考，不要把它们写进总结正文",
    );
    expect(summaryRequestText).toContain(
      "定位信息（仅供理解，不要写入总结正文）",
    );
    expect(summaryRequestText).toContain(
      "总结预算来自当前聊天助手绑定的上下文配置",
    );
    await screen.findByText(/已总结/);

    expect(screen.getByText("显示总结")).toBeEnabled();
    fireEvent.click(screen.getByText("显示总结"));
    expect(screen.getByLabelText("当前上下文总结")).toHaveTextContent(
      "SUMMARY RESULT",
    );
    expect(screen.getAllByText("SUMMARY RESULT")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "数据检查器" }));
    expect(
      screen.getByRole("dialog", { name: "数据检查器" }),
    ).toBeInTheDocument();
    expect(screen.getByText("数据库概览")).toBeInTheDocument();
    expect(screen.getByText("当前对话")).toBeInTheDocument();
    expect(screen.getByText("Summary diff")).toBeInTheDocument();
    expect(screen.getByText("覆盖原文")).toBeInTheDocument();
    expect(screen.getAllByText("保留 tail").length).toBeGreaterThan(0);
    expect(screen.getAllByText("请求投影").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("数据检查概览")).toBeInTheDocument();
  });

  it("rewrites over-budget context summaries before storing them", async () => {
    const summaryRequests: string[] = [];
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const inputText = Array.isArray(body.input)
        ? body.input
            .map((item: { content?: string }) => item.content)
            .join("\n")
        : "";

      if (inputText.includes("请把下面的 MobileChat 上下文总结改写")) {
        summaryRequests.push(inputText);
        return Promise.resolve(
          new Response(JSON.stringify({ output_text: "SHORT SUMMARY" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      if (inputText.includes("请为 MobileChat 当前单个对话")) {
        summaryRequests.push(inputText);
        return Promise.resolve(
          new Response(JSON.stringify({ output_text: "过长".repeat(260) }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify({ output_text: "chat response" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.click(screen.getByText("设置"));
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://api.example.test/v1" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "test-key" },
    });
    fireEvent.click(screen.getByText("新增模型"));
    fireEvent.click(screen.getByLabelText("允许模型 默认连接 new-model-1"));
    fireEvent.change(screen.getByLabelText("上下文总结字数上限"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByLabelText("关闭设置"));

    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "budget seed" },
    });
    fireEvent.click(screen.getByLabelText("发送"));
    await screen.findByText("chat response");

    fireEvent.click(screen.getByText("总结上下文"));
    await waitFor(() => expect(summaryRequests).toHaveLength(2));
    await screen.findByText(/已总结/);

    fireEvent.click(screen.getByText("显示总结"));
    expect(screen.getByLabelText("当前上下文总结")).toHaveTextContent(
      "SHORT SUMMARY",
    );
  });

  it("automatically summarizes completed message intervals and reuses the previous summary", async () => {
    const summaryRequests: string[] = [];
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const inputText = Array.isArray(body.input)
        ? body.input
            .map((item: { content?: string }) => item.content)
            .join("\n")
        : "";

      if (inputText.includes("请为 MobileChat 当前单个对话")) {
        summaryRequests.push(inputText);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              output_text: `AUTO SUMMARY ${summaryRequests.length}`,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            output_text: `chat ${fetchMock.mock.calls.length}`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    configureApiProfile({ apiKey: "test-key" });
    fireEvent.click(screen.getByText("设置"));
    fireEvent.change(screen.getByLabelText("自动总结间隔条数"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByLabelText("关闭设置"));

    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "first turn" },
    });
    fireEvent.click(screen.getByLabelText("发送"));
    await waitFor(() => expect(summaryRequests).toHaveLength(1));
    await screen.findByText(/后台已总结到 2 条/);

    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "second turn" },
    });
    fireEvent.click(screen.getByLabelText("发送"));
    await waitFor(() => expect(summaryRequests).toHaveLength(2));

    expect(summaryRequests[1]).toContain("AUTO SUMMARY 1");
    expect(summaryRequests[1]).toContain("second turn");
    await screen.findByText(/后台已总结到 4 条/);
  });

  it("uses web search as a single-turn composer option", async () => {
    const fetchMock = vi.fn();
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output_text: "searched once" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output_text: "plain once" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    configureApiProfile({ apiKey: "test-key" });

    fireEvent.click(screen.getByLabelText("新建对话"));
    fireEvent.click(screen.getByLabelText("本轮联网"));
    expect(screen.getByLabelText("本轮联网")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText(/联网 · 仅文本/)).toBeInTheDocument();
    expect(screen.queryByText(/本轮:/)).not.toBeInTheDocument();
    expect(screen.queryByText("本轮选项")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "需要搜索" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    expect(await screen.findByText("searched once")).toBeInTheDocument();
    expect(
      JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).tools,
    ).toEqual([{ type: "web_search" }]);
    expect(screen.getByLabelText("本轮联网")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "不搜索" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    expect(await screen.findByText("plain once")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).tools).toBe(
      undefined,
    );
  });

  it("can stop a pending model request after API key is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>(() => {
            // keep the request pending until the user presses stop
          }),
      ),
    );
    render(<App />);
    configureApiProfile({ apiKey: "test-key" });

    fireEvent.click(screen.getByLabelText("新建对话"));
    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "测试停止" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    expect(screen.getByText("正在等待流式输出…")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("停止"));

    await waitFor(() =>
      expect(screen.getByText("已停止生成。")).toBeInTheDocument(),
    );
  });

  it("opens settings and toggles theme, layout, and streaming mode", () => {
    const androidBridge = {
      setStatusBarHidden: vi.fn(),
    };
    window.MobileChatAndroid = androidBridge;
    render(<App />);

    fireEvent.click(screen.getByText("设置"));

    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument();
    expectCustomSelectValue("上下文总结助手", "总结助手");

    chooseCustomSelectOption("主题模式", "亮色");
    expect(document.documentElement.dataset.theme).toBe("light");

    expectCustomSelectValue("布局模式", "跟随屏幕");
    chooseCustomSelectOption("布局模式", "电脑端");
    expect(screen.getByRole("main")).toHaveClass("desktop-layout");
    chooseCustomSelectOption("布局模式", "手机端");
    expect(screen.getByRole("main")).not.toHaveClass("desktop-layout");
    expect(screen.getByRole("main")).toHaveClass("mobile-layout");

    expect(screen.getByLabelText("流式输出")).toBeChecked();
    fireEvent.click(screen.getByLabelText("流式输出"));
    expect(screen.getByLabelText("流式输出")).not.toBeChecked();

    expect(androidBridge.setStatusBarHidden).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByLabelText("沉浸显示（Android）"));
    expect(androidBridge.setStatusBarHidden).toHaveBeenLastCalledWith(true);

    expectCustomSelectValue("换行规则", "Enter 发送");
    chooseCustomSelectOption("换行规则", "Enter 换行");
    expectCustomSelectValue("换行规则", "Enter 换行");
    expect(screen.getByLabelText("总结保留原文条数")).toHaveValue(8);
    fireEvent.change(screen.getByLabelText("总结保留原文条数"), {
      target: { value: "3" },
    });
    expect(screen.getByLabelText("总结保留原文条数")).toHaveValue(3);

    chooseCustomSelectOption("设置中选择助手", "总结助手");
    expectCustomSelectValue("功能助手模型策略", "跟随当前对话模型");
    expect(
      screen.queryByRole("combobox", { name: "该助手默认模型" }),
    ).not.toBeInTheDocument();
    chooseCustomSelectOption("功能助手模型策略", "指定模型");
    expect(getCustomSelect("该助手默认模型")).toBeDisabled();
    expectCustomSelectValue("该助手默认模型", "未选择");
    chooseCustomSelectOption("功能助手模型策略", "跟随当前对话模型");
    expect(
      screen.queryByRole("combobox", { name: "该助手默认模型" }),
    ).not.toBeInTheDocument();
    chooseCustomSelectOption("设置中选择助手", "默认助手");

    expect(screen.getByLabelText("严格记忆系统描述")).toHaveValue(
      "只记录用户明确确认的需求、硬约束、长期偏好、必须遵守的规则和不可丢失结论。",
    );
    fireEvent.change(screen.getByLabelText("严格记忆系统描述"), {
      target: { value: "自定义严格记忆描述" },
    });
    expect(screen.getByLabelText("严格记忆系统描述")).toHaveValue(
      "自定义严格记忆描述",
    );
    fireEvent.click(screen.getByLabelText("还原严格记忆默认描述"));
    expect(screen.getByLabelText("严格记忆系统描述")).toHaveValue(
      "只记录用户明确确认的需求、硬约束、长期偏好、必须遵守的规则和不可丢失结论。",
    );
    fireEvent.change(screen.getByLabelText("精确事实系统描述"), {
      target: { value: "自定义精确事实描述" },
    });
    expect(screen.getByLabelText("精确事实系统描述")).toHaveValue(
      "自定义精确事实描述",
    );
    fireEvent.click(screen.getByText("还原全部默认描述"));
    expect(screen.getByLabelText("精确事实系统描述")).toHaveValue(
      "记录可精确引用的事实、字段、路径、版本、模型、配置、数值、角色属性和世界规则。禁止保存 API key 原文。",
    );

    expectCustomSelectValue("选择上下文配置", "通用上下文");
    expectCustomSelectValue("助手上下文配置", "通用上下文");
    expect(screen.getByLabelText("上下文总结字数上限")).toHaveValue(6000);
    fireEvent.change(screen.getByLabelText("上下文总结字数上限"), {
      target: { value: "12000" },
    });
    expect(screen.getByLabelText("上下文总结字数上限")).toHaveValue(12000);
    fireEvent.click(screen.getByText("新增上下文配置"));
    expectCustomSelectValue("选择上下文配置", "上下文配置 2");
    expect(screen.getByLabelText("上下文总结字数上限")).toHaveValue(6000);
    fireEvent.click(screen.getByLabelText("上移 上下文配置 上下文配置 2"));
    expect(
      screen.getByLabelText("上移 上下文配置 上下文配置 2"),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("上下文配置名称"), {
      target: { value: "角色扮演上下文" },
    });
    fireEvent.change(screen.getByLabelText("模糊记忆上下文重载说明"), {
      target: { value: "记录关系温度、心情变化和共同经历。" },
    });
    expect(screen.getByLabelText("模糊记忆上下文重载说明")).toHaveValue(
      "记录关系温度、心情变化和共同经历。",
    );
    expect(screen.getByLabelText("启用模糊记忆上下文维度")).toBeChecked();
    fireEvent.click(screen.getByLabelText("启用模糊记忆上下文维度"));
    expect(screen.getByLabelText("启用模糊记忆上下文维度")).not.toBeChecked();
    expect(screen.getByLabelText("模糊记忆上下文重载说明")).toBeDisabled();
    expect(screen.getByLabelText("模糊记忆上下文重载说明")).toHaveValue(
      "记录关系温度、心情变化和共同经历。",
    );
    fireEvent.click(screen.getByLabelText("启用模糊记忆上下文维度"));
    expect(screen.getByLabelText("模糊记忆上下文重载说明")).toBeEnabled();
    chooseCustomSelectOption("助手上下文配置", "角色扮演上下文");
    expectCustomSelectValue("助手上下文配置", "角色扮演上下文");
    fireEvent.click(screen.getByText("还原当前配置重载"));
    expect(screen.getByLabelText("模糊记忆上下文重载说明")).toHaveValue("");

    expect(screen.getByLabelText("API Key")).toHaveAttribute(
      "type",
      "password",
    );
    fireEvent.click(screen.getByLabelText("显示密钥"));
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByLabelText("隐藏密钥"));
    expect(screen.getByLabelText("API Key")).toHaveAttribute(
      "type",
      "password",
    );

    fireEvent.click(screen.getByLabelText("关闭设置"));
    expect(
      screen.queryByRole("dialog", { name: "设置" }),
    ).not.toBeInTheDocument();
  });

  it("parses an agent standard output into a new context profile", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<App />);

    fireEvent.click(screen.getByText("设置"));

    fireEvent.click(screen.getByText("复制起始说明"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const startPrompt = String(writeText.mock.calls[0]?.[0]);
    expect(startPrompt).toContain("MobileChat 上下文配置讨论起始说明");
    expect(startPrompt).toContain("固定五维定义");
    expect(startPrompt).toContain("不要直接导出 JSON");
    expect(startPrompt).toContain("收敛式配置访谈");
    expect(startPrompt).toContain("每轮最多追问 3 个关键问题");
    expect(startPrompt).toContain("如果必须给备选，最多 3 个");
    expect(startPrompt).toContain("严格记忆");
    expect(screen.getByText("已复制起始说明。")).toBeInTheDocument();

    fireEvent.click(screen.getByText("复制导出说明"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    const exportPrompt = String(writeText.mock.calls[1]?.[0]);
    expect(exportPrompt).toContain("MobileChat 上下文配置导出说明");
    expect(exportPrompt).toContain("JSON 只允许");
    expect(exportPrompt).toContain('"strict_memory"');
    expect(screen.getByText("已复制导出说明。")).toBeInTheDocument();

    const parseArea = screen.getByLabelText("上下文配置解析区");
    fireEvent.change(parseArea, {
      target: {
        value: `设计说明：跑团需要保留规则和当前场面，压缩临时闲聊。

\`\`\`json
{
  "name": "跑团上下文",
  "description": "用于跑团主持",
  "summaryMaxChars": 12000,
  "dimensions": {
    "strict_memory": { "enabled": true, "instruction": "记录不可违背的团规和回复格式。" },
    "precise_facts": { "enabled": true, "instruction": "记录角色属性、世界规则和数值。" },
    "fuzzy_memory": { "enabled": false, "instruction": "" },
    "exploration_log": { "enabled": true, "instruction": "记录随机事件、尝试路线和未确认线索。" },
    "current_state": { "enabled": true, "instruction": "记录当前场景、行动顺序和待确认问题。" }
  }
}
\`\`\``,
      },
    });
    fireEvent.click(screen.getByText("解析并新建配置"));

    expect(
      screen.getByText("已解析并新建上下文配置「跑团上下文」。"),
    ).toBeInTheDocument();
    expect(parseArea).toHaveValue("");
    expectCustomSelectValue("选择上下文配置", "跑团上下文");
    expect(screen.getByLabelText("上下文配置名称")).toHaveValue("跑团上下文");
    expect(screen.getByLabelText("上下文总结字数上限")).toHaveValue(12000);
    expect(screen.getByLabelText("严格记忆上下文重载说明")).toHaveValue(
      "记录不可违背的团规和回复格式。",
    );
    expect(screen.getByLabelText("精确事实上下文重载说明")).toHaveValue(
      "记录角色属性、世界规则和数值。",
    );
    expect(screen.getByLabelText("启用模糊记忆上下文维度")).not.toBeChecked();
    expect(screen.getByLabelText("探索记录上下文重载说明")).toHaveValue(
      "记录随机事件、尝试路线和未确认线索。",
    );
  });

  it("clears the context profile parse area after parse failure", () => {
    render(<App />);

    fireEvent.click(screen.getByText("设置"));
    const parseArea = screen.getByLabelText("上下文配置解析区");
    fireEvent.change(parseArea, {
      target: { value: "这不是 JSON 配置" },
    });

    fireEvent.click(screen.getByText("解析并新建配置"));

    expect(
      screen.getByText("未找到可解析的 JSON 配置块。"),
    ).toBeInTheDocument();
    expect(parseArea).toHaveValue("");
  });

  it("keeps the floating scroll shortcut focused on returning to the bottom", () => {
    window.localStorage.setItem(
      "mobilechat:ui-preferences",
      JSON.stringify({ layoutMode: "mobile" }),
    );

    render(<App />);

    const messageThread = screen.getByLabelText("消息列表");
    Object.defineProperty(messageThread, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(messageThread, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(messageThread, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });

    fireEvent.scroll(messageThread);
    expect(screen.getByLabelText("回到消息底部")).toBeInTheDocument();
    expect(screen.getByLabelText("回到消息顶部")).toBeInTheDocument();

    messageThread.scrollTop = 800;
    fireEvent.scroll(messageThread);
    expect(screen.queryByLabelText("回到消息底部")).not.toBeInTheDocument();
    expect(screen.getByLabelText("回到消息顶部")).toBeInTheDocument();
  });

  it("scrolls to the bottom immediately after sending a message", async () => {
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
      () => undefined,
    );
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    render(<App />);

    const messageThread = screen.getByLabelText("消息列表");
    const threadScrollTo = vi.fn();
    Object.defineProperty(messageThread, "scrollHeight", {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(messageThread, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(messageThread, "scrollTo", {
      configurable: true,
      value: threadScrollTo,
    });

    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "触发滚动" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    await waitFor(() =>
      expect(threadScrollTo).toHaveBeenCalledWith({
        top: 1200,
        behavior: "smooth",
      }),
    );
    expect(requestAnimationFrameSpy).toHaveBeenCalled();
  });

  it("edits API profiles, models, and assistant model bindings", () => {
    render(<App />);

    fireEvent.click(screen.getByText("设置"));

    expect(
      screen.queryByRole("button", { name: /编辑模型/ }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://api.example.test/v1" },
    });
    fireEvent.click(screen.getByText("新增模型"));
    expect(screen.getByLabelText("模型名称")).toHaveValue("new-model-1");
    fireEvent.change(screen.getByLabelText("模型名称"), {
      target: { value: "主模型" },
    });
    expect(screen.getByLabelText("模型名称")).toHaveValue("主模型");

    fireEvent.click(screen.getByText("新增模型"));
    expect(screen.getByLabelText("模型名称")).toHaveValue("new-model-2");
    expect(screen.getByLabelText("模型描述")).toHaveValue("");
    fireEvent.click(screen.getByLabelText("上移 模型 new-model-2"));
    expect(screen.getByLabelText("上移 模型 new-model-2")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("下移 模型 new-model-2"));
    expect(screen.getByLabelText("下移 模型 new-model-2")).toBeDisabled();
    fireEvent.click(screen.getByText("删除模型"));
    expect(screen.getByLabelText("模型名称")).toHaveValue("主模型");

    fireEvent.click(screen.getByText("新增"));
    expectCustomSelectValue("设置中选择助手", "新助手 3");
    while (
      !(screen.getByLabelText("上移 聊天助手 新助手 3") as HTMLButtonElement)
        .disabled
    ) {
      fireEvent.click(screen.getByLabelText("上移 聊天助手 新助手 3"));
    }
    expect(screen.getByLabelText("上移 聊天助手 新助手 3")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("助手名称"), {
      target: { value: "移动助手" },
    });
    fireEvent.change(screen.getByLabelText("初始 Prompt"), {
      target: { value: "移动端编辑后的 prompt" },
    });

    expectCustomSelectValue("选择助手", "移动助手");
    expectCustomSelectValue("选择助手", "移动助手");
    expect(screen.getByLabelText("初始 Prompt")).toHaveValue(
      "移动端编辑后的 prompt",
    );

    fireEvent.click(screen.getByText("新增"));
    expectCustomSelectValue("设置中选择助手", "新助手 4");
  });

  it("archives, searches, browses, and restores conversations", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("新建对话"));
    fireEvent.click(screen.getByLabelText("编辑标题"));
    fireEvent.change(screen.getByLabelText("对话标题"), {
      target: { value: "归档测试" },
    });
    fireEvent.click(screen.getByLabelText("保存标题"));
    fireEvent.click(screen.getByText("归档"));

    expect(
      screen.getByRole("navigation", { name: "归档对话列表" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("归档测试").length).toBeGreaterThan(0);
    expect(
      screen.getByPlaceholderText("归档对话仅浏览，恢复后可继续"),
    ).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("搜索归档标题或摘要"), {
      target: { value: "归档测试" },
    });
    expect(screen.getAllByText("归档测试").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText("搜索归档标题或摘要"), {
      target: { value: "归档 测试" },
    });
    expect(screen.getAllByText("归档测试").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText("搜索归档标题或摘要"), {
      target: { value: "归档.*测试" },
    });
    fireEvent.click(screen.getByRole("button", { name: "对话正则搜索" }));
    expect(screen.getAllByText("归档测试").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("恢复当前"));
    expect(
      screen.getByRole("navigation", { name: "对话列表" }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入消息")).toBeEnabled();
  });

  it("searches messages with loose space matching and regex mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    configureApiProfile({ apiKey: "test-key" });

    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "alpha middle beta" },
    });
    fireEvent.click(screen.getByLabelText("发送"));
    await screen.findByText("alpha middle beta");

    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "second regex topic" },
    });
    fireEvent.click(screen.getByLabelText("发送"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const searchInput = screen.getByLabelText("搜索当前对话消息");
    fireEvent.change(searchInput, { target: { value: "alpha beta" } });
    await waitFor(() =>
      expect(
        screen.getByText("alpha middle beta").closest("article"),
      ).toHaveClass("search-active"),
    );

    fireEvent.change(searchInput, { target: { value: "second.*topic" } });
    fireEvent.click(screen.getByRole("button", { name: "正则搜索" }));
    await waitFor(() =>
      expect(
        screen.getByText("second regex topic").closest("article"),
      ).toHaveClass("search-active"),
    );

    fireEvent.change(searchInput, { target: { value: "p" } });
    expect(screen.getAllByText("ok")[0]?.closest("article")).not.toHaveClass(
      "search-hit",
    );
  });

  it("deletes conversations, API profiles, and assistants with safe fallbacks", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    fireEvent.click(screen.getByLabelText("新建对话"));
    expect(screen.getAllByText("新对话 2")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.queryByText("新对话 2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("新建对话"));
    fireEvent.click(screen.getByLabelText("编辑标题"));
    fireEvent.change(screen.getByLabelText("对话标题"), {
      target: { value: "归档删除测试" },
    });
    fireEvent.click(screen.getByLabelText("保存标题"));
    fireEvent.click(screen.getByText("归档"));
    expect(screen.getAllByText("归档删除测试").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.queryByText("归档删除测试")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("设置"));
    fireEvent.click(screen.getByText("新增连接"));
    expectCustomSelectValue("选择连接", "连接 2");
    expect(screen.queryByLabelText("模型描述")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("上移 连接 连接 2"));
    expect(screen.getByLabelText("上移 连接 连接 2")).toBeDisabled();
    fireEvent.click(screen.getByText("删除连接"));
    expectCustomSelectValue("选择连接", "默认连接");

    fireEvent.click(screen.getByText("新增"));
    expectCustomSelectValue("设置中选择助手", "新助手 3");
    fireEvent.click(screen.getByText("删除助手"));
    expectCustomSelectValue("设置中选择助手", "默认助手");
  });

  it("retries assistant replies and deletes messages", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    configureApiProfile();

    fireEvent.click(screen.getByLabelText("新建对话"));
    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "测试重试" },
    });
    fireEvent.click(screen.getByLabelText("发送"));
    expect(
      await screen.findByText(/请先在设置页.*API key/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试回复" }));
    expect(
      await screen.findByText(/请先在设置页.*API key/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重答消息" }));
    expect(
      await screen.findByText(/请先在设置页.*API key/),
    ).toBeInTheDocument();

    const deleteButtons = screen.getAllByRole("button", { name: "删除消息" });
    expect(deleteButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(deleteButtons[1]);

    expect(confirmSpy).toHaveBeenCalledWith("删除这条消息？");
    expect(screen.queryByText(/请先在设置页.*API key/)).not.toBeInTheDocument();
  });
});
