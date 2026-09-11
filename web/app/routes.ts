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
  layout("routes/planning.tsx", [
    route("select", "routes/select.tsx"),
    route("schedule", "routes/schedule.tsx"),
    route("create/template", "routes/create-template.tsx"),
    route("manage/template", "routes/manage-template.tsx"),
    route("admin", "routes/admin.tsx"),
  ]),
] satisfies RouteConfig;
