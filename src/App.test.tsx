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

  it("renders the mobile chat shell", () => {
    render(<App />);

    expect(
      screen.getByRole("region", { name: "当前对话" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "对话列表" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("调试诊断")).toBeInTheDocument();
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

    for (let index = 0; index < 5; index += 1) {
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
    await screen.findByText(/已总结/);

    expect(screen.getByText("显示总结")).toBeEnabled();
    fireEvent.click(screen.getByText("显示总结"));
    expect(screen.getByLabelText("当前上下文总结")).toHaveTextContent(
      "SUMMARY RESULT",
    );
    expect(screen.getAllByText("SUMMARY RESULT")).toHaveLength(1);
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
    expect(screen.getByText("API Profiles")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("主题模式"), {
      target: { value: "light" },
    });
    expect(document.documentElement.dataset.theme).toBe("light");

    expect(screen.getByLabelText("布局模式")).toHaveValue("auto");
    fireEvent.change(screen.getByLabelText("布局模式"), {
      target: { value: "desktop" },
    });
    expect(screen.getByRole("main")).toHaveClass("desktop-layout");
    fireEvent.change(screen.getByLabelText("布局模式"), {
      target: { value: "mobile" },
    });
    expect(screen.getByRole("main")).not.toHaveClass("desktop-layout");
    expect(screen.getByRole("main")).toHaveClass("mobile-layout");

    expect(screen.getByLabelText("流式输出")).toBeChecked();
    fireEvent.click(screen.getByLabelText("流式输出"));
    expect(screen.getByLabelText("流式输出")).not.toBeChecked();

    expect(screen.getByLabelText("上下文总结助手")).toHaveValue(
      "context-summary-gpt54",
    );
    fireEvent.change(screen.getByLabelText("上下文总结助手"), {
      target: { value: "compact" },
    });
    expect(screen.getByLabelText("上下文总结助手")).toHaveValue("compact");
    expect(screen.getByLabelText("上下文压缩助手")).toHaveValue("compact");

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
    fireEvent.click(screen.getByText("删除当前模型"));
    expect(screen.getByLabelText("模型名称")).toHaveValue("主模型");

    fireEvent.click(screen.getByText("新增"));
    expect(screen.getByLabelText("设置中选择助手")).toHaveDisplayValue(
      "新助手 4",
    );
    fireEvent.change(screen.getByLabelText("助手名称"), {
      target: { value: "移动助手" },
    });
    fireEvent.change(screen.getByLabelText("初始 Prompt"), {
      target: { value: "移动端编辑后的 prompt" },
    });

    expect(screen.getByLabelText("选择助手")).toHaveDisplayValue("移动助手");
    fireEvent.click(screen.getByText("设为当前"));
    expect(screen.getByLabelText("选择助手")).toHaveDisplayValue("移动助手");
    expect(screen.getByLabelText("初始 Prompt")).toHaveValue(
      "移动端编辑后的 prompt",
    );

    fireEvent.click(screen.getByText("新增"));
    expect(screen.getByLabelText("设置中选择助手")).toHaveDisplayValue(
      "新助手 5",
    );
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
    fireEvent.click(screen.getByText("新增 Profile"));
    expect(screen.getByLabelText("选择 API Profile")).toHaveDisplayValue(
      "API Profile 2",
    );
    expect(screen.getByLabelText("模型描述")).toHaveValue("");
    fireEvent.click(screen.getByText("删除当前 Profile"));
    expect(screen.getByLabelText("选择 API Profile")).toHaveDisplayValue(
      "默认连接",
    );

    fireEvent.click(screen.getByText("新增"));
    expect(screen.getByLabelText("设置中选择助手")).toHaveDisplayValue(
      "新助手 4",
    );
    fireEvent.click(screen.getByText("删除助手"));
    expect(screen.getByLabelText("设置中选择助手")).toHaveDisplayValue(
      "默认助手",
    );
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
