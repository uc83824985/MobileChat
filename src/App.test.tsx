import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { deleteMobileChatDb } from "./persistence/mobileChatDb";

describe("App", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    expect(screen.getAllByText("新对话 4")).toHaveLength(2);
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
    expect(screen.queryByText(/in 5 \/ out/)).not.toBeInTheDocument();
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

  it("opens settings and toggles theme and streaming mode", () => {
    render(<App />);

    fireEvent.click(screen.getByText("设置"));

    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByText("API Profiles")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("主题模式"), {
      target: { value: "light" },
    });
    expect(document.documentElement.dataset.theme).toBe("light");

    expect(screen.getByLabelText("流式输出")).toBeChecked();
    fireEvent.click(screen.getByLabelText("流式输出"));
    expect(screen.getByLabelText("流式输出")).not.toBeChecked();

    fireEvent.click(screen.getByLabelText("关闭设置"));
    expect(
      screen.queryByRole("dialog", { name: "设置" }),
    ).not.toBeInTheDocument();
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

    expect(screen.getByLabelText("启用联网工具")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("启用联网工具"));
    expect(screen.getByLabelText("启用联网工具")).toBeChecked();

    fireEvent.click(screen.getByText("新增模型"));
    expect(screen.getByLabelText("模型名称")).toHaveValue("new-model-2");
    fireEvent.click(screen.getByText("删除当前模型"));
    expect(screen.getByLabelText("模型名称")).toHaveValue("主模型");

    fireEvent.change(screen.getByLabelText("设置中选择助手"), {
      target: { value: "research" },
    });
    fireEvent.change(screen.getByLabelText("助手名称"), {
      target: { value: "移动助手" },
    });
    fireEvent.change(screen.getByLabelText("初始 Prompt"), {
      target: { value: "移动端编辑后的 prompt" },
    });

    expect(screen.getByLabelText("选择助手")).toHaveDisplayValue("架构助手");
    fireEvent.click(screen.getByText("设为当前"));
    expect(screen.getByLabelText("选择助手")).toHaveDisplayValue("移动助手");
    expect(screen.getByLabelText("初始 Prompt")).toHaveValue(
      "移动端编辑后的 prompt",
    );

    fireEvent.click(screen.getByText("新增"));
    expect(screen.getByLabelText("设置中选择助手")).toHaveDisplayValue(
      "新助手 4",
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
    expect(screen.getAllByText("新对话 4")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.queryByText("新对话 4")).not.toBeInTheDocument();

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
      "架构助手",
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
