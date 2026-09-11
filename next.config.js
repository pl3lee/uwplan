/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
  devIndicators: false,
  generateBuildId: async () => {
    const revision = process.env.RELEASE_REVISION ?? "";
    return /^[a-zA-Z0-9._-]{1,128}$/.test(revision) ? revision : "development";
  },
};

export default config;
