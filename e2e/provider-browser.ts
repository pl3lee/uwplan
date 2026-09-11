import type { Page } from "@playwright/test";

function fixtureAuthorization(location: string) {
  const url = new URL(location);
  const provider = new Map([
    ["https://github.com/login/oauth/authorize", "github"],
    ["https://accounts.google.com/o/oauth2/v2/auth", "google"],
  ]).get(`${url.origin}${url.pathname}`);
  if (!provider) throw new Error("Unexpected provider authorization endpoint");
  return `${process.env.E2E_OAUTH_ORIGIN}/${provider}/authorize${url.search}`;
}

export async function useProviderFixture(page: Page) {
  if (process.env.E2E_RUNTIME === "go") {
    // Native redirects are one intercepted request chain. Execute the real
    // sign-in endpoint, retain its state cookie, and only replace the browser's
    // external destination with the controlled authorization page.
    await page.route(
      `${process.env.E2E_BASE_URL}/api/auth/signin/*`,
      async (route) => {
        const response = await route.fetch({ maxRedirects: 0 });
        if (response.status() !== 302)
          throw new Error("Sign-in did not redirect");
        const target = fixtureAuthorization(response.headers().location!);
        const headers: Record<string, string> = {
          ...response.headers(),
          "content-type": "text/html",
        };
        delete headers.location;
        delete headers["content-length"];
        await route.fulfill({
          response,
          status: 200,
          headers,
          body: `<script>location.replace(${JSON.stringify(target)})</script>`,
        });
      },
    );
  } else {
    await page.route(
      "https://github.com/login/oauth/authorize**",
      async (route) => {
        const target = fixtureAuthorization(route.request().url());
        // WebKit cannot fulfill intercepted requests with 3xx responses.
        await route.fulfill({
          contentType: "text/html",
          body: `<script>location.replace(${JSON.stringify(target)})</script>`,
        });
      },
    );
  }
}
