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
