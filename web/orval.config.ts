import { defineConfig } from "orval";

export default defineConfig({
  api: {
    input: { target: "../api/openapi/openapi.json" },
    output: {
      clean: true,
      client: "react-query",
      httpClient: "fetch",
      mode: "single",
      target: "./app/generated/api/client.ts",
      schemas: "./app/generated/api/model",
      override: {
        mutator: { path: "./app/lib/api-fetch.ts", name: "apiFetch" },
        query: { useMutation: true, useQuery: true },
      },
    },
  },
});
