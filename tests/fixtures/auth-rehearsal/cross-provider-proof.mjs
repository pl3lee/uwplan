import { OAuthAccountNotLinked } from "@auth/core/errors";
import { handleLoginOrRegister } from "../../../node_modules/@auth/core/lib/actions/callback/handle-login.js";
import GitHub from "next-auth/providers/github";

import { oauthProviderSecurityOptions } from "../../../src/server/auth/provider-policy.ts";

const mutations = {
  users: 0,
  accounts: 0,
  sessions: 0,
  plans: 0,
  schedules: 0,
};
const existingUser = {
  id: "existing-google-user",
  email: "same-email@example.invalid",
  emailVerified: null,
};
const github = GitHub(oauthProviderSecurityOptions);
const normalizedGithub = {
  ...github,
  account: github.account ?? ((tokenSet) => tokenSet),
  allowDangerousEmailAccountLinking:
    github.options?.allowDangerousEmailAccountLinking,
};

const adapter = {
  async getUserByAccount() {
    return null;
  },
  async getUserByEmail(email) {
    return email === existingUser.email ? existingUser : null;
  },
  async createUser() {
    mutations.users += 1;
    mutations.plans += 1;
    mutations.schedules += 1;
    throw new Error("same-email attempt created a user");
  },
  async linkAccount() {
    mutations.accounts += 1;
    throw new Error("same-email attempt linked an account");
  },
  async createSession() {
    mutations.sessions += 1;
    throw new Error("same-email attempt created a session");
  },
};

let error = null;
try {
  await handleLoginOrRegister(
    null,
    { ...existingUser, name: "Synthetic existing identity" },
    {
      type: "oauth",
      provider: "github",
      providerAccountId: "new-github-account",
    },
    {
      adapter,
      cookies: { sessionToken: { name: "authjs.session-token" } },
      events: {},
      jwt: {},
      provider: normalizedGithub,
      session: {
        strategy: "database",
        maxAge: 3600,
        generateSessionToken: () => "must-not-be-used",
      },
    },
  );
} catch (candidate) {
  error = candidate;
}

if (!(error instanceof OAuthAccountNotLinked)) {
  throw error ?? new Error("same-email attempt was unexpectedly accepted");
}
if (Object.values(mutations).some((value) => value !== 0)) {
  throw new Error("same-email rejection mutated authentication state");
}

process.stdout.write(
  `${JSON.stringify({
    error: error.type,
    mutations,
    allowDangerousEmailAccountLinking:
      github.options?.allowDangerousEmailAccountLinking,
    githubScopes: github.authorization?.params?.scope,
  })}\n`,
);
