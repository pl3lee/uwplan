import GitHub from "next-auth/providers/github";

// GitHub includes this issuer in OAuth callbacks; keep issuer validation enabled.
export const githubProvider = GitHub({
  issuer: "https://github.com/login/oauth",
});
