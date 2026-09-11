import {
  index,
  layout,
  type RouteConfig,
  route,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("signin", "routes/signin.tsx"),
  route("api/*", "routes/api.proxy.ts"),
  layout("routes/planning.tsx", [route("select", "routes/select.tsx")]),
] satisfies RouteConfig;
