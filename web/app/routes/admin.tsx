import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { data, redirect, useNavigate } from "react-router";
import { ApiErrorMessage } from "~/components/api-error";
import { TemplateCards } from "~/components/template-cards";
import { serverApiOptions } from "~/lib/api.server";
import { ApiError } from "~/lib/api-fetch";
import { loadPrivate } from "~/lib/auth.server";
import { readTemplates, templatesQuery } from "~/lib/planning";
import { readUsers, usersQuery } from "~/lib/template-management";
import type { Route } from "./+types/admin";

export async function loader({ request }: Route.LoaderArgs) {
  return loadPrivate(request, async (user) => {
    if (user.role !== "admin") throw redirect("/select");
    const options = serverApiOptions(request);
    try {
      const [templates, users] = await Promise.all([
        readTemplates(options),
        readUsers(options),
      ]);
      return data(
        { templates, users },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 403)
        throw redirect("/select");
      throw error;
    }
  });
}
export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = () => [{ title: "UWPlan - Admin" }];
export default function Admin({ loaderData }: Route.ComponentProps) {
  const templates = useQuery({
    ...templatesQuery,
    initialData: loaderData.templates,
  });
  const users = useQuery({ ...usersQuery, initialData: loaderData.users });
  const navigate = useNavigate();
  const denied = users.error instanceof ApiError && users.error.status === 403;
  useEffect(() => {
    if (denied) void navigate("/select", { replace: true });
  }, [denied, navigate]);
  if (denied) return null;
  return (
    <div className="container mx-auto py-10">
      <h1 className="text-4xl font-bold tracking-tight text-primary">
        Admin page
      </h1>
      <section className="mt-8">
        <h2 className="mb-4 text-2xl font-bold">
          Users{users.data.length ? ` (${users.data.length})` : ""}
        </h2>
        <ApiErrorMessage error={users.error} />
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                {["Name", "Email", "Role"].map((label) => (
                  <th
                    key={label}
                    className="h-10 px-2 text-left font-medium text-muted-foreground"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.data.map((user) => (
                <tr key={user.id} className="border-b last:border-0">
                  <td className="p-2">{user.name ?? "N/A"}</td>
                  <td className="p-2">{user.email}</td>
                  <td className="p-2">{user.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="mt-8">
        <h2 className="mb-4 text-2xl font-bold">
          Templates{templates.data.length ? ` (${templates.data.length})` : ""}
        </h2>
        <ApiErrorMessage error={templates.error} />
        <TemplateCards templates={templates.data} />
      </section>
    </div>
  );
}
