import { expect, test } from "@playwright/test";

test("opens the mobile chat shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("region", { name: "当前对话" })).toBeVisible();
  await expect(page.getByText("Context diagnostics")).toBeVisible();
  await page.getByLabel("打开对话列表").tap();
  await expect(
    page.getByRole("navigation", { name: "对话列表" }),
  ).toBeVisible();
});

test("supports basic mobile interactions", async ({ page }) => {
  await page.goto("/");

  await page.getByLabel("打开对话列表").tap();
  await page.getByLabel("新建对话").tap();
  await expect(page.getByText("开始一个新对话")).toBeVisible();

  await page.getByPlaceholder("输入消息").fill("测试移动端发送");
  await page.getByLabel("发送").tap();
  await expect(page.getByText("测试移动端发送", { exact: true })).toBeVisible();
  await expect(page.getByText("正在生成模拟回复……")).toBeVisible();

  await page.getByLabel("停止").tap();
  await expect(page.getByText("已停止生成。")).toBeVisible();

  await page.getByLabel("打开对话列表").tap();
  await page.getByText("设置").tap();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await expect(page.getByText("API Profiles")).toBeVisible();

  const settingsRow = page.getByText("API Profiles").locator("..");
  const rowBox = await settingsRow.boundingBox();
  expect(rowBox?.height).toBeLessThan(90);
});
