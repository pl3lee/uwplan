import { createServer } from "node:http";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

const issuers = {
  google: "https://accounts.google.com",
  github: "https://github.com/login/oauth",
};

export async function startOAuthFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "e2e",
    alg: "RS256",
    use: "sig",
  };
  const codes = new Map();
  const tokens = new Map();
  let origin;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const [, provider, operation] = url.pathname.split("/");
    const json = (body, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!Object.hasOwn(issuers, provider))
      return json({ error: "unknown_provider" }, 404);
    if (operation === "discovery")
      return json({
        issuer: issuers[provider],
        authorization_endpoint: `${origin}/${provider}/authorize`,
        token_endpoint: `${origin}/${provider}/token`,
        userinfo_endpoint: `${origin}/${provider}/user`,
        jwks_uri: `${origin}/${provider}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: [
          "client_secret_post",
          "client_secret_basic",
        ],
        code_challenge_methods_supported: ["S256"],
      });
    if (operation === "jwks") return json({ keys: [jwk] });
    if (operation === "authorize" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(
        '<html><body><h1>Test identity provider</h1><form method="post"><label>Account<input name="account" type="email" required></label><button>Authorize</button></form></body></html>',
      );
    }
    if (operation === "authorize" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const account = new URLSearchParams(body).get("account");
      const redirect = new URL(url.searchParams.get("redirect_uri"));
      if (
        redirect.origin !== process.env.E2E_BASE_URL ||
        !account?.endsWith("@example.test")
      ) {
        return json({ error: "invalid_request" }, 400);
      }
      const code = randomUUID();
      codes.set(code, { provider, account, params: url.searchParams });
      redirect.searchParams.set("code", code);
      redirect.searchParams.set("iss", issuers[provider]);
      if (url.searchParams.has("state"))
        redirect.searchParams.set("state", url.searchParams.get("state"));
      res.writeHead(302, { Location: redirect.toString() });
      return res.end();
    }
    if (operation === "token") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body);
      const grant = codes.get(params.get("code"));
      codes.delete(params.get("code"));
      if (!grant)
        return json(
          {
            error: "invalid_grant",
            error_description: "Code missing or already consumed",
          },
          400,
        );
      if (grant.provider !== provider)
        return json(
          { error: "invalid_grant", error_description: "Provider mismatch" },
          400,
        );
      if (params.get("redirect_uri") !== grant.params.get("redirect_uri")) {
        return json(
          { error: "invalid_grant", error_description: "Redirect mismatch" },
          400,
        );
      }
      const client = req.headers.authorization?.startsWith("Basic ")
        ? Buffer.from(req.headers.authorization.slice(6), "base64")
            .toString()
            .split(":")
        : [params.get("client_id"), params.get("client_secret")];
      if (
        client[0] !== `e2e-${provider}` ||
        client[1] !== `e2e-${provider}-secret`
      ) {
        return json({ error: "invalid_client" }, 401);
      }
      const challenge = grant.params.get("code_challenge");
      if (
        challenge &&
        createHash("sha256")
          .update(params.get("code_verifier") ?? "")
          .digest("base64url") !== challenge
      ) {
        return json(
          { error: "invalid_grant", error_description: "PKCE mismatch" },
          400,
        );
      }
      const token = randomUUID();
      tokens.set(token, grant.account);
      const claims = {
        iss: issuers[provider],
        sub: grant.account,
        aud: `e2e-${provider}`,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        name: "OAuth Student",
        email: grant.account,
        email_verified: true,
        ...(grant.params.has("nonce")
          ? { nonce: grant.params.get("nonce") }
          : {}),
      };
      const unsigned = [{ alg: "RS256", kid: "e2e" }, claims]
        .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
        .join(".");
      const idToken = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
      return json({
        access_token: token,
        token_type: "bearer",
        expires_in: 300,
        ...(provider === "google" ? { id_token: idToken } : {}),
        scope: "openid profile email read:user user:email",
      });
    }
    if (operation === "user") {
      const account = tokens.get(
        req.headers.authorization?.replace(/^Bearer /i, ""),
      );
      if (!account) return json({ error: "invalid_token" }, 401);
      return json({
        id: account,
        sub: account,
        login: account,
        name: "OAuth Student",
        email: account,
        email_verified: true,
      });
    }
    return json({ error: "not_found" }, 404);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
