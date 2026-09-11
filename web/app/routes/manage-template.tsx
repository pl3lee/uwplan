import { useQuery } from "@tanstack/react-query";
import { data } from "react-router";
import { ApiErrorMessage } from "~/components/api-error";
import { TemplateCards } from "~/components/template-cards";
import { serverApiOptions } from "~/lib/api.server";
import { loadPrivate } from "~/lib/auth.server";
import {
  ownedTemplatesQuery,
  readOwnedTemplates,
} from "~/lib/template-management";
import type { Route } from "./+types/manage-template";

export async function loader({ request }: Route.LoaderArgs) {
  return loadPrivate(request, async () =>
    data(
      { templates: await readOwnedTemplates(serverApiOptions(request)) },
      { headers: { "Cache-Control": "no-store" } },
    ),
  );
}
export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = () => [{ title: "UWPlan - Manage Academic Plans" }];
export default function ManageTemplate({ loaderData }: Route.ComponentProps) {
  const templates = useQuery({
    ...ownedTemplatesQuery,
    initialData: loaderData.templates,
  });
  return (
    <div className="container mx-auto py-10">
      <h1 className="text-4xl font-bold tracking-tight text-primary">
        Manage Your Created Plans
      </h1>
      <div role="note" className="mt-8 rounded-lg border p-4 text-sm">
        <h2 className="mb-1 font-medium">Can't find your created plan?</h2>
        <p>
          Then you must have created your academic plan before this
          functionality was implemented, and we do not know what plans you have
          created. Please email billy.pl.lee@gmail.com for assistance.
        </p>
      </div>
      <div className="mt-8">
        <h2 className="mb-4 text-2xl font-bold">Your Created Plans</h2>
        <ApiErrorMessage error={templates.error} />
        <TemplateCards templates={templates.data} />
      </div>
    </div>
  );
}
