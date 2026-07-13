import { expect, test } from "@playwright/test";

const resetDb = async (page: import("@playwright/test").Page) => {
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase("MobileChatDB");
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => resolve();
      }),
  );
  await page.reload();
};

const openSettings = async (page: import("@playwright/test").Page) => {
  const drawerButton = page.getByLabel("打开对话列表");
  if (await drawerButton.isVisible()) {
    await drawerButton.click();
    await expect(page.locator(".conversation-rail")).toHaveClass(/open/);
  }
  await page
    .getByRole("button", { name: "设置", exact: true })
    .evaluate((element: HTMLElement) => element.click());
};

test.beforeEach(async ({ page }) => {
  await resetDb(page);
});

test("opens the mobile chat shell", async ({ page }) => {
  await expect(page.getByRole("region", { name: "当前对话" })).toBeVisible();
  await expect(page.getByText("Context diagnostics")).toBeVisible();
  await expect(page.getByLabel("选择助手")).toBeVisible();
  await expect(page.getByLabel("选择模型")).toBeVisible();

  if (await page.getByLabel("打开对话列表").isVisible()) {
    await page.getByLabel("打开对话列表").click();
  }
  await expect(
    page.getByRole("navigation", { name: "对话列表" }),
  ).toBeVisible();
});

test("supports basic mobile interactions, title editing, and model switching", async ({
  page,
}) => {
  if (await page.getByLabel("打开对话列表").isVisible()) {
    await page.getByLabel("打开对话列表").click();
  }
  await page.getByLabel("新建对话").click();
  await expect(page.locator(".conversation-rail")).not.toHaveClass(/open/);
  await expect(page.getByText("开始一个新对话")).toBeVisible();

  await page.getByLabel("编辑标题").click();
  await page.getByLabel("对话标题").fill("手机标题");
  await page.getByLabel("保存标题").click();
  await expect(page.getByText("手机标题")).toHaveCount(2);

  await page.getByLabel("选择助手").selectOption("research");
  await expect(page.getByLabel("选择助手")).toHaveValue("research");
  await expect(page.getByLabel("选择模型")).toHaveValue("mnapi::gpt-5.4-mini");

  await page.getByLabel("选择模型").selectOption("mnapi::gpt-5.4");
  await expect(page.getByLabel("选择模型")).toHaveValue("mnapi::gpt-5.4");

  await page.getByPlaceholder("输入消息").fill("测试移动端发送");
  await page.getByLabel("发送").click();
  await expect(page.getByText("测试移动端发送", { exact: true })).toBeVisible();
  await expect(page.getByText(/请先在设置页.*API key/)).toBeVisible();

  await openSettings(page);
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await expect(page.getByText("API Profiles")).toBeVisible();
  await expect(page.getByLabel("设置中选择助手")).toHaveValue("research");

  await page.getByLabel("主题模式").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByLabel("流式输出")).toBeChecked();
  await page.getByLabel("流式输出").uncheck({ force: true });
  await expect(page.getByLabel("流式输出")).not.toBeChecked();

  await page.getByLabel("助手名称").fill("手机研究助手");
  await page.getByLabel("初始 Prompt").fill("手机端可编辑当前助手 prompt。");
  await page.getByLabel("模型名称").fill("MNAPI Mini");
  await expect(page.getByLabel("助手名称")).toHaveValue("手机研究助手");
  await expect(page.getByLabel("初始 Prompt")).toHaveValue(
    "手机端可编辑当前助手 prompt。",
  );
  await expect(page.getByLabel("模型名称")).toHaveValue("MNAPI Mini");
});

test("keeps settings rows compact on mobile", async ({ page }, testInfo) => {
  await openSettings(page);
  const settingsRow = page.getByText("API Profiles").locator("..");
  const rowBox = await settingsRow.boundingBox();
  if (testInfo.project.name === "Mobile Chrome") {
    expect(rowBox?.height).toBeLessThan(90);
  }
});

test("verifies persistence and .mobilechat import/export on desktop", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "Desktop Chrome",
    "PC persistence verification runs on the desktop project.",
  );

  await page.getByLabel("新建对话").click();
  await page.getByLabel("编辑标题").click();
  await page.getByLabel("对话标题").fill("PC 自定义标题");
  await page.getByLabel("保存标题").click();
  await openSettings(page);

  await page.getByLabel("主题模式").selectOption("light");
  await page.getByLabel("流式输出").uncheck({ force: true });
  await page.getByLabel("API Key").fill("desktop-local-key");
  await page.getByLabel("模型名称").fill("PC MNAPI High");
  await page.getByLabel("助手名称").fill("PC 持久化助手");
  await page.getByLabel("初始 Prompt").fill("PC 端验证持久化 prompt。");
  await expect(page.getByText("已保存")).toBeVisible({ timeout: 6000 });

  await page.reload();
  await expect(
    page.getByLabel("当前对话").getByText("PC 自定义标题"),
  ).toBeVisible();
  await openSettings(page);
  await expect(page.getByLabel("主题模式")).toHaveValue("light");
  await expect(page.getByLabel("流式输出")).not.toBeChecked();
  await expect(page.getByLabel("API Key")).toHaveValue("desktop-local-key");
  await expect(page.getByLabel("模型名称")).toHaveValue("PC MNAPI High");
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
  await expect(page.getByLabel("API Key")).toHaveValue("");
  await expect(
    page.getByText("已导入 .mobilechat 并替换本地数据"),
  ).toBeVisible();
});
