import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { deleteMobileChatDb } from "./persistence/mobileChatDb";

describe("App", () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await deleteMobileChatDb();
  });

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

  it("creates a conversation and reports missing API key for the real request loop", async () => {
    render(<App />);

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

    fireEvent.click(screen.getByText("设置"));
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "test-key" },
    });
    fireEvent.click(screen.getByLabelText("关闭设置"));

    fireEvent.click(screen.getByLabelText("新建对话"));
    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "测试停止" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    expect(screen.getByText("正在请求模型…")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("停止"));

    await waitFor(() =>
      expect(screen.getByText("已停止生成。")).toBeInTheDocument(),
    );
  });

  it("opens settings and toggles theme mode", () => {
    render(<App />);

    fireEvent.click(screen.getByText("设置"));

    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByText("API Profiles")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("主题模式"), {
      target: { value: "light" },
    });
    expect(document.documentElement.dataset.theme).toBe("light");

    fireEvent.click(screen.getByLabelText("关闭设置"));
    expect(
      screen.queryByRole("dialog", { name: "设置" }),
    ).not.toBeInTheDocument();
  });

  it("edits API profiles, models, and assistant model bindings", () => {
    render(<App />);

    fireEvent.click(screen.getByText("设置"));

    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://api.mnapi.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("模型名称"), {
      target: { value: "MNAPI High" },
    });
    expect(screen.getByLabelText("模型名称")).toHaveValue("MNAPI High");

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
});
