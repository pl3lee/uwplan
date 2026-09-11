// Loaded only by the Playwright webServer command. No app authentication bypass.
const origin = process.env.E2E_OAUTH_ORIGIN;
if (!origin || new URL(origin).hostname !== "127.0.0.1") {
  throw new Error("OAuth fixture requires a local test provider");
}
const destinations = new Map([
  [
    "https://accounts.google.com/.well-known/openid-configuration",
    "/google/discovery",
  ],
  ["https://github.com/login/oauth/access_token", "/github/token"],
  ["https://api.github.com/user", "/github/user"],
]);
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  const destination = destinations.get(`${url.origin}${url.pathname}`);
  if (!destination) return originalFetch(input, init);
  const target = `${origin}${destination}${url.search}`;
  return originalFetch(
    input instanceof Request ? new Request(target, input) : target,
    init,
  );
};
