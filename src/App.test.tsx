import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
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

  it("creates a conversation and sends then stops a local placeholder response", () => {
    render(<App />);

    fireEvent.click(screen.getByLabelText("新建对话"));
    expect(screen.getAllByText("新对话 4")).toHaveLength(2);
    expect(screen.getByText("开始一个新对话")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("输入消息"), {
      target: { value: "测试发送" },
    });
    fireEvent.click(screen.getByLabelText("发送"));

    expect(screen.getByText("测试发送")).toBeInTheDocument();
    expect(screen.getByText("正在生成模拟回复……")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("停止"));
    expect(screen.getByText("已停止生成。")).toBeInTheDocument();
  });

  it("opens settings without stretching rows across the panel", () => {
    render(<App />);

    fireEvent.click(screen.getByText("设置"));

    expect(screen.getByRole("dialog", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByText("API Profiles")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("关闭设置"));
    expect(
      screen.queryByRole("dialog", { name: "设置" }),
    ).not.toBeInTheDocument();
  });

  it("selects and edits assistants through reflected settings fields", () => {
    render(<App />);

    fireEvent.change(screen.getByLabelText("选择助手"), {
      target: { value: "research" },
    });

    expect(screen.getByLabelText("选择助手")).toHaveValue("research");

    fireEvent.click(screen.getByText("设置"));

    expect(screen.getByLabelText("设置中选择助手")).toHaveValue("research");

    fireEvent.change(screen.getByLabelText("助手名称"), {
      target: { value: "移动助手" },
    });
    fireEvent.change(screen.getByLabelText("初始 Prompt"), {
      target: { value: "移动端编辑后的 prompt" },
    });

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
