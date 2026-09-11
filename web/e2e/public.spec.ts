import { expect, test } from "@playwright/test";

test("public pages render and navigate on the production build", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /UWPlan/ }).first(),
  ).toBeVisible();
  await page.getByText("Get Started", { exact: true }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in with GitHub" }),
  ).toBeVisible();
  await page.getByText("Back to Home", { exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { name: /Privacy Policy/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("both provider buttons submit their native sign-in forms", async ({
  page,
}) => {
  // This tests the web form boundary. Real provider callbacks remain covered by
  // the API tests and shared behavior suite, not by this intercepted navigation.
  await page.route("**/api/auth/signin/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "Provider sign-in requested",
    }),
  );
  for (const [provider, label] of [
    ["google", "Google"],
    ["github", "GitHub"],
  ]) {
    await page.goto("/signin");
    await page.getByRole("button", { name: `Sign in with ${label}` }).click();
    await expect(page).toHaveURL(
      new RegExp(`/api/auth/signin/${provider}\\??$`),
    );
    await expect(page.getByText("Provider sign-in requested")).toBeVisible();
  }
});

test("sign-in failures show a safe recovery message", async ({ page }) => {
  await page.goto("/signin?error=OAuthAccountNotLinked");
  await expect(page.getByRole("alert")).toContainText(
    "Use the method you originally signed up with",
  );
  await page.goto("/signin?error=credential-sentinel");
  await expect(page.getByRole("alert")).toHaveText(
    "Sign-in could not be completed. Please try again.",
  );
  await expect(page.getByText("credential-sentinel")).toHaveCount(0);
});
