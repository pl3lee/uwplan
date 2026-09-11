import { useQuery } from "@tanstack/react-query";
import { data, Outlet, useOutletContext } from "react-router";
import { ApiErrorMessage } from "~/components/api-error";
import { PlanningNav } from "~/components/planning-nav";
import type {
  PlanStateBody,
  TemplateBody,
  UserBody,
} from "~/generated/api/model";
import { serverApiOptions } from "~/lib/api.server";
import { loadPrivate } from "~/lib/auth.server";
import {
  planQuery,
  readPlan,
  readTemplates,
  templatesQuery,
} from "~/lib/planning";
import type { Route } from "./+types/planning";

export async function loader({ request }: Route.LoaderArgs) {
  return loadPrivate(request, async (user) => {
    const options = serverApiOptions(request);
    const [plan, templates] = await Promise.all([
      readPlan(options),
      readTemplates(options),
    ]);
    return data(
      { user, plan, templates },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
export const headers = () => ({ "Cache-Control": "no-store" });

type PlanningContext = {
  user: UserBody;
  plan: PlanStateBody;
  templates: TemplateBody[];
};
export const usePlanning = () => useOutletContext<PlanningContext>();

export default function Planning({ loaderData }: Route.ComponentProps) {
  const plan = useQuery({ ...planQuery, initialData: loaderData.plan });
  const templates = useQuery({
    ...templatesQuery,
    initialData: loaderData.templates,
  });
  const context = {
    user: loaderData.user,
    plan: plan.data,
    templates: templates.data,
  };
  return (
    <>
      <PlanningNav {...context} />
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 pb-16 sm:px-6 lg:px-8 md:pb-0">
        <ApiErrorMessage error={plan.error ?? templates.error} />
        <Outlet context={context} />
      </main>
    </>
  );
}
