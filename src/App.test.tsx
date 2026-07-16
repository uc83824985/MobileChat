import {
  cleanup,
  fireEvent,
  render,
  screen,
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
    vi.stubGlobal("indexedDB", new IDBFactory());
    window.localStorage.clear();
    await deleteMobileChatDb();
  });

  const configureApiProfile = ({
    baseUrl = "https://api.example.test/v1",
    apiKey = "",
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
    expect(
      screen.queryByRole("option", { name: "压缩助手" }),
    ).not.toBeInTheDocument();
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

    const composer = screen.getByPlaceholderText(
      "输入消息",
    ) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: "alphaomega" } });
    composer.setSelectionRange(5, 5);
    fireEvent.keyDown(composer, { key: "j", ctrlKey: true });
    expect(composer).toHaveValue("alpha\nomega");

    fireEvent.click(screen.getByText("设置"));
    chooseCustomSelectOption("输入快捷键", "Enter 换行，Ctrl+Enter 发送");
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

    configureApiProfile({ apiKey: "test-key" });

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
    render(<App />);

    fireEvent.click(screen.getByText("设置"));

    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument();
    expect(screen.getAllByText("连接配置").length).toBeGreaterThan(0);

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

    expectCustomSelectValue("输入快捷键", "Enter 发送，Shift+Enter 换行");
    chooseCustomSelectOption("输入快捷键", "Enter 换行，Ctrl+Enter 发送");
    expectCustomSelectValue("输入快捷键", "Enter 换行，Ctrl+Enter 发送");
    expect(screen.getByLabelText("总结保留原文条数")).toHaveValue(8);
    fireEvent.change(screen.getByLabelText("总结保留原文条数"), {
      target: { value: "3" },
    });
    expect(screen.getByLabelText("总结保留原文条数")).toHaveValue(3);

    expectCustomSelectValue("上下文总结助手", "上下文总结助手");
    chooseCustomSelectOption("上下文总结助手", "压缩助手");
    expectCustomSelectValue("上下文总结助手", "压缩助手");
    expectCustomSelectValue("上下文压缩助手", "压缩助手");
    chooseCustomSelectOption("设置中选择助手", "压缩助手");
    expectCustomSelectValue("功能助手模型策略", "跟随当前对话模型");
    expect(
      screen.queryByRole("combobox", { name: "该助手默认模型" }),
    ).not.toBeInTheDocument();
    chooseCustomSelectOption("功能助手模型策略", "指定模型");
    expectCustomSelectValue("该助手默认模型", "默认连接 / 默认模型");
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
    fireEvent.click(screen.getByText("新增上下文配置"));
    expectCustomSelectValue("选择上下文配置", "上下文配置 2");
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

  it("updates the floating scroll shortcut after manual thread scrolling", () => {
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

    messageThread.scrollTop = 800;
    fireEvent.scroll(messageThread);
    expect(screen.getByLabelText("回到消息顶部")).toBeInTheDocument();
  });

  it("edits API profiles, models, and assistant model bindings", () => {
    render(<App />);

    fireEvent.click(screen.getByText("设置"));

    expect(
      screen.getByRole("button", { name: "编辑模型 默认模型" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://api.example.test/v1" },
    });
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
    fireEvent.click(screen.getByText("删除当前模型"));
    expect(screen.getByLabelText("模型名称")).toHaveValue("主模型");

    fireEvent.click(screen.getByText("新增"));
    expectCustomSelectValue("设置中选择助手", "新助手 4");
    while (
      !(screen.getByLabelText("上移 聊天助手 新助手 4") as HTMLButtonElement)
        .disabled
    ) {
      fireEvent.click(screen.getByLabelText("上移 聊天助手 新助手 4"));
    }
    expect(screen.getByLabelText("上移 聊天助手 新助手 4")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("助手名称"), {
      target: { value: "移动助手" },
    });
    fireEvent.change(screen.getByLabelText("初始 Prompt"), {
      target: { value: "移动端编辑后的 prompt" },
    });

    expectCustomSelectValue("选择助手", "移动助手");
    fireEvent.click(screen.getByText("设为当前"));
    expectCustomSelectValue("选择助手", "移动助手");
    expect(screen.getByLabelText("初始 Prompt")).toHaveValue(
      "移动端编辑后的 prompt",
    );

    fireEvent.click(screen.getByText("新增"));
    expectCustomSelectValue("设置中选择助手", "新助手 5");
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

    fireEvent.click(screen.getByText(/已归档/));
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

    fireEvent.click(screen.getByText("恢复当前"));
    expect(
      screen.getByRole("navigation", { name: "对话列表" }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入消息")).toBeEnabled();
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
    fireEvent.click(screen.getByText(/已归档/));
    expect(screen.getAllByText("归档删除测试").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(screen.queryByText("归档删除测试")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("设置"));
    fireEvent.click(screen.getByText("新增连接"));
    expectCustomSelectValue("选择连接", "连接 2");
    expect(screen.getByLabelText("模型描述")).toHaveValue("");
    fireEvent.click(screen.getByLabelText("上移 连接 连接 2"));
    expect(screen.getByLabelText("上移 连接 连接 2")).toBeDisabled();
    fireEvent.click(screen.getByText("删除当前连接"));
    expectCustomSelectValue("选择连接", "默认连接");

    fireEvent.click(screen.getByText("新增"));
    expectCustomSelectValue("设置中选择助手", "新助手 4");
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
