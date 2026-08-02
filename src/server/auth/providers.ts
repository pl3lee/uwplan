import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";

import { oauthProviderSecurityOptions } from "./provider-policy";

// Keep cross-provider account linking explicitly fail-closed. Auth.js defaults
// this option to false, but rehearsal acceptance must not depend on an
// upstream default silently changing.
export const oauthProviders = [
  Google(oauthProviderSecurityOptions),
  GitHub(oauthProviderSecurityOptions),
];
