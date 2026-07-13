import { expect, test } from "@playwright/test";

const openSettings = async (page: import("@playwright/test").Page) => {
  const drawerButton = page.getByLabel("打开对话列表");
  if (await drawerButton.isVisible()) {
    await drawerButton.click();
  }
  await page.getByText("设置").click();
};

test("opens the mobile chat shell", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("region", { name: "当前对话" })).toBeVisible();
  await expect(page.getByText("Context diagnostics")).toBeVisible();
  if (await page.getByLabel("打开对话列表").isVisible()) {
    await page.getByLabel("打开对话列表").click();
  }
  await expect(
    page.getByRole("navigation", { name: "对话列表" }),
  ).toBeVisible();
});

test("supports basic mobile interactions", async ({ page }, testInfo) => {
  await page.goto("/");

  if (await page.getByLabel("打开对话列表").isVisible()) {
    await page.getByLabel("打开对话列表").click();
  }
  await page.getByLabel("新建对话").click();
  await expect(page.getByText("开始一个新对话")).toBeVisible();

  await page.getByLabel("选择助手").selectOption("research");
  await expect(page.getByLabel("选择助手")).toHaveValue("research");

  await page.getByPlaceholder("输入消息").fill("测试移动端发送");
  await page.getByLabel("发送").click();
  await expect(page.getByText("测试移动端发送", { exact: true })).toBeVisible();
  await expect(page.getByText("正在生成模拟回复……")).toBeVisible();

  await page.getByLabel("停止").click();
  await expect(page.getByText("已停止生成。")).toBeVisible();

  await openSettings(page);
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await expect(page.getByText("API Profiles")).toBeVisible();
  await expect(page.getByLabel("设置中选择助手")).toHaveValue("research");

  const settingsRow = page.getByText("API Profiles").locator("..");
  const rowBox = await settingsRow.boundingBox();
  if (testInfo.project.name === "Mobile Chrome") {
    expect(rowBox?.height).toBeLessThan(90);
  }

  await page.getByLabel("助手名称").fill("手机研究助手");
  await page.getByLabel("初始 Prompt").fill("手机端可编辑当前助手 prompt。");
  await expect(page.getByLabel("助手名称")).toHaveValue("手机研究助手");
  await expect(page.getByLabel("初始 Prompt")).toHaveValue(
    "手机端可编辑当前助手 prompt。",
  );
});

test("verifies persistence and .mobilechat import/export on desktop", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "Desktop Chrome",
    "PC persistence verification runs on the desktop project.",
  );

  await page.goto("/");
  await openSettings(page);

  await page.getByLabel("助手名称").fill("PC 持久化助手");
  await page.getByLabel("初始 Prompt").fill("PC 端验证持久化 prompt。");
  await expect(page.getByText("已保存")).toBeVisible({ timeout: 6000 });

  await page.reload();
  await openSettings(page);
  await expect(page.getByLabel("助手名称")).toHaveValue("PC 持久化助手");
  await expect(page.getByLabel("初始 Prompt")).toHaveValue(
    "PC 端验证持久化 prompt。",
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByText("导出 .mobilechat").click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  await page.getByLabel("助手名称").fill("导入前临时名称");
  await expect(page.getByText("已保存")).toBeVisible({ timeout: 6000 });

  await page.getByLabel("导入 mobilechat 文件").setInputFiles(downloadPath!);
  await expect(page.getByLabel("助手名称")).toHaveValue("PC 持久化助手");
  await expect(
    page.getByText("已导入 .mobilechat 并替换本地数据"),
  ).toBeVisible();
});
