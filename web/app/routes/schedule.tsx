import { useQuery } from "@tanstack/react-query";
import { data, useSearchParams } from "react-router";
import { ApiErrorMessage } from "~/components/api-error";
import { ScheduleManagement } from "~/components/schedule-management";
import { ScrollToTopButton } from "~/components/scroll-to-top";
import { serverApiOptions } from "~/lib/api.server";
import { loadPrivate } from "~/lib/auth.server";
import { readSchedules, schedulesQuery } from "~/lib/scheduling";
import type { Route } from "./+types/schedule";

export async function loader({ request }: Route.LoaderArgs) {
  return loadPrivate(request, async () =>
    data(
      { schedules: await readSchedules(serverApiOptions(request)) },
      { headers: { "Cache-Control": "no-store" } },
    ),
  );
}
export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = () => [{ title: "UWPlan - Schedule Courses" }];

export default function Schedule({ loaderData }: Route.ComponentProps) {
  const schedules = useQuery({
    ...schedulesQuery,
    initialData: loaderData.schedules,
  });
  const [params] = useSearchParams();
  const id = params.get("scheduleId") || schedules.data[0]?.id;
  const active = schedules.data.find((item) => item.id === id);
  if (!active)
    return (
      <p>
        You do not have access to this schedule, or the schedule is invalid.
      </p>
    );
  return (
    <div className="container mx-auto py-10">
      <h1 className="text-4xl font-bold tracking-tight text-primary">
        Schedule Your Courses
      </h1>
      <div className="space-y-6 py-10">
        <ApiErrorMessage error={schedules.error} />
        <ScheduleManagement schedules={schedules.data} active={active} />
      </div>
      <ScrollToTopButton />
    </div>
  );
}
