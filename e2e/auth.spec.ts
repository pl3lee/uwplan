import { randomUUID } from "node:crypto";
import { test, expect } from "./fixtures";
import { useProviderFixture } from "./provider-browser";

for (const provider of ["Google", "GitHub"]) {
  test(`${provider} callback provisions a user and returns to their saved schedule @smoke`, async ({
    page,
  }) => {
    await useProviderFixture(page);
    const account = `${randomUUID()}@example.test`;
    async function login() {
      await page.goto("/signin");
      await page
        .getByRole("button", { name: `Sign in with ${provider}`, exact: true })
        .click();
      await page.getByLabel("Account", { exact: true }).fill(account);
      await page
        .getByRole("button", { name: "Authorize", exact: true })
        .click();
      await expect(page).toHaveURL(/\/select$/);
    }
    await login();
    await page.goto("/schedule");
    await expect(
      page.getByRole("link", { name: "Default", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Rename Schedule", exact: true })
      .click();
    await page
      .getByLabel("New Name", { exact: true })
      .fill("Persisted OAuth plan");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Persisted OAuth plan", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign Out", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await login();
    await page.goto("/schedule");
    await expect(
      page.getByRole("link", { name: "Persisted OAuth plan", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Default", exact: true }),
    ).toHaveCount(0);
  });

  test(`${provider} rejects an unsolicited callback`, async ({ page }) => {
    await page.goto(
      `/api/auth/callback/${provider.toLowerCase()}?code=forged-code&state=forged-state`,
    );
    await page.goto("/select");
    await expect(page).toHaveURL(/\/signin$/);
  });
}
