import postgres from "postgres";
import { test, expect, chooseTemplate, mutate } from "./fixtures";

test("Select reuses a production-sized catalog across navigation", async ({
  page,
  user,
  signIn,
}, testInfo) => {
  const url = process.env.E2E_DATABASE_URL;
  if (!url || new URL(url).pathname !== "/uwplan_e2e")
    throw new Error("This test requires the disposable E2E database");
  const sql = postgres(url, { max: 1 });
  const prefix = `P${user.id.slice(0, 4)}`;
  try {
    // The real catalog contains 10,742 courses and several MB of text. Keep
    // these synthetic rows separate from every other test's saved choices.
    await sql`insert into course (code, name, description)
      select ${prefix} || n, 'Performance fixture', repeat('Catalog detail. ', 24)
      from generate_series(1, 10736) n`;
    await signIn(user);
    await page.clock.install();
    let catalogRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/v1/courses")
        catalogRequests++;
    });
    const response = await page.goto("/select");
    const html = await response!.text();
    expect(Buffer.byteLength(html)).toBeLessThan(100_000);
    expect(html).not.toContain(prefix);
    await chooseTemplate(page, user.templateName);
    const checkbox = page.getByRole("checkbox", {
      name: "Take CS135",
      exact: true,
    });
    await mutate(page, () => checkbox.check());
    await expect(
      page.getByRole("table").first().getByText("CS135", { exact: true }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(catalogRequests).toBe(1);

    // Cross the former 30-second stale window without a wall-clock sleep.
    await page.clock.fastForward(31_000);
    const timings: number[] = [];
    for (let visit = 0; visit < 3; visit++) {
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Schedule", exact: true })
        .click();
      await expect(page).toHaveURL(/\/schedule$/);
      const start = Date.now();
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Select", exact: true })
        .click();
      await expect(checkbox).toBeChecked();
      timings.push(Date.now() - start);
      await page.waitForLoadState("networkidle");
      expect(catalogRequests).toBe(1);
    }
    // A stale catalog refresh must not hold the navigation or hide saved rows.
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Schedule", exact: true })
      .click();
    await expect(page).toHaveURL(/\/schedule$/);
    await page.clock.fastForward(5 * 60_000);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/v1/courses", async (route) => {
      await held;
      await route.continue();
    });
    try {
      await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Select", exact: true })
        .click();
      await expect(checkbox).toBeChecked();
      await expect.poll(() => catalogRequests).toBe(2);
    } finally {
      release();
    }
    await page.waitForLoadState("networkidle");
    await testInfo.attach("navigation-measurements", {
      body: JSON.stringify({
        htmlBytes: Buffer.byteLength(html),
        catalogRequests,
        selectNavigationMs: timings,
      }),
      contentType: "application/json",
    });
  } finally {
    await sql`delete from course where starts_with(code, ${prefix})`;
    await sql.end();
  }
});

test("a failed catalog load can be retried", async ({ page, user, signIn }) => {
  await signIn(user);
  await page.route(
    "**/api/v1/courses",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "Temporary catalog failure" }),
      }),
    { times: 1 },
  );
  await page.goto("/select");
  await expect(page.getByRole("alert")).toContainText(
    "Unable to save or load your plan",
  );
  await page.getByRole("button", { name: "Retry loading courses" }).click();
  await chooseTemplate(page, user.templateName);
  await expect(
    page.getByRole("checkbox", { name: "Take CS135", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
