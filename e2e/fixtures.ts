import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

export type TestUser = {
  id: string;
  scheduleId: string;
  templateName: string;
  sessionToken: string;
};
type Fixtures = {
  user: TestUser;
  createUser: (options?: {
    admin?: boolean;
    expired?: boolean;
  }) => Promise<TestUser>;
  signIn: (user: TestUser, context?: BrowserContext) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  createUser: async ({}, use) => {
    const url = process.env.E2E_DATABASE_URL;
    if (!url || new URL(url).pathname !== "/uwplan_e2e") {
      throw new Error(
        "Use npm run test:e2e; fixtures require the disposable E2E database",
      );
    }
    const sql = postgres(url, { max: 1 });
    try {
      await use(async (options = {}) => {
        const id = randomUUID();
        const planId = randomUUID();
        const scheduleId = randomUUID();
        const templateId = randomUUID();
        const templateName = `Mathematics ${id.slice(0, 8)}`;
        const sessionToken = randomUUID();
        await sql.begin(async (tx) => {
          await tx`insert into "user" (id, name, email, role) values
            (${id}, 'Browser Student', ${`${id}@example.test`}, ${options.admin ? "admin" : "user"})`;
          await tx`insert into plan (id, user_id) values (${planId}, ${id})`;
          await tx`insert into schedule (id, name, plan_id) values (${scheduleId}, 'Default', ${planId})`;
          await tx`insert into user_term_range (user_id, start_term, start_year, end_term, end_year)
            values (${id}, 'Fall', 2026, 'Spring', 2027)`;
          await tx`insert into session (session_token, user_id, expires) values
            (${sessionToken}, ${id}, ${new Date(Date.now() + (options.expired ? -60_000 : 3_600_000))})`;
          await tx`insert into course (code, name, useful_rating, liked_rating, easy_rating, num_ratings, description)
            values ('CS135', 'Designing Functional Programs', .8, .7, .6, 100, 'Learn functional programming'),
              ('CS136', 'Elementary Algorithm Design', .9, .8, .5, 80, 'Design algorithms'),
              ('MATH135', 'Algebra for Honours Mathematics', .7, .6, .4, 60, 'Learn algebra'),
              ('ECON101', 'Introduction to Microeconomics', .6, .5, .8, 40, 'Study markets')
            on conflict (code) do nothing`;
          await tx`insert into template (id, name, description, created_by)
            values (${templateId}, ${templateName}, 'Browser test degree requirements', ${id})`;
          const instruction = randomUUID();
          const fixed = randomUUID();
          const separator = randomUUID();
          const free = randomUUID();
          await tx`insert into template_item (id, template_id, type, description, order_index) values
            (${instruction}, ${templateId}, 'instruction', 'Complete the core and choose an elective', 0),
            (${fixed}, ${templateId}, 'requirement', 'Core courses', 1),
            (${separator}, ${templateId}, 'separator', null, 2),
            (${free}, ${templateId}, 'requirement', 'Choose an elective', 3)`;
          await tx`insert into course_item (requirement_id, type, course_id)
            select ${fixed}, 'fixed', id from course where code in ('CS135', 'MATH135')`;
          await tx`insert into course_item (requirement_id, type) values (${free}, 'free')`;
        });
        return { id, scheduleId, templateName, sessionToken };
      });
    } finally {
      await sql.end();
    }
  },
  user: async ({ createUser }, use) => {
    await use(await createUser());
  },
  signIn: async ({ context, baseURL }, use) => {
    await use(async (user, target = context) => {
      await target.addCookies([
        {
          name: "authjs.session-token",
          value: user.sessionToken,
          url: baseURL!,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
    });
  },
});

export { expect };

export async function mutate(page: Page, action: () => Promise<unknown>) {
  const origin = new URL(page.url()).origin;
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).origin === origin &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(
          response.request().method(),
        ),
    ),
    action(),
  ]);
  // Mutation responses acknowledge the write. The flow then asserts rendered
  // state and reloads it; it does not rely on optimistic updates alone.
  expect(response.status()).toBeLessThan(500);
  // The legacy UI can repaint from an earlier action while another is pending.
  // Settle the action and its refresh before the next user interaction.
  await page.waitForLoadState("networkidle");
}

export async function reloadSavedPage(page: Page) {
  await page.reload();
  // SSR text appears before client event handlers are ready in every browser.
  // The controlled test environment has no background polling or remote media.
  await page.waitForLoadState("networkidle");
}

export async function chooseTemplate(page: Page, name: string) {
  const wasSelected = (await page.getByText(name, { exact: true }).count()) > 0;
  await page
    .getByRole("combobox", { name: "Academic plans", exact: true })
    .click();
  await page.getByPlaceholder("Search academic plan...").fill(name);
  await mutate(page, () =>
    page.getByRole("option", { name, exact: true }).click(),
  );
  await page.keyboard.press("Escape");
  await expect(page.getByText(name, { exact: true })).toHaveCount(
    wasSelected ? 0 : 1,
  );
}

export async function selectCoreCourse(page: Page, user: TestUser) {
  await page.goto("/select");
  await chooseTemplate(page, user.templateName);
  await mutate(page, () =>
    page
      .getByRole("row")
      .filter({ hasText: "Designing Functional Programs" })
      .getByRole("checkbox")
      .check(),
  );
  await expect(
    page.getByRole("table").first().getByText("CS135", { exact: true }),
  ).toBeVisible();
}
