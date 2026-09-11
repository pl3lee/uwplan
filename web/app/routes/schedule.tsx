import { useQuery } from "@tanstack/react-query";
import { data, useSearchParams } from "react-router";
import { ApiErrorMessage } from "~/components/api-error";
import { ScheduleManagement } from "~/components/schedule-management";
import { ScrollToTopButton } from "~/components/scroll-to-top";
import { TermRangeSelector, termLabels } from "~/components/term-range";
import type {
  ScheduleBody,
  ScheduleViewResponseBody,
} from "~/generated/api/model";
import { serverApiOptions } from "~/lib/api.server";
import { ApiError } from "~/lib/api-fetch";
import { loadPrivate } from "~/lib/auth.server";
import {
  readSchedule,
  readSchedules,
  scheduleQuery,
  schedulesQuery,
} from "~/lib/scheduling";
import type { Route } from "./+types/schedule";

export async function loader({ request }: Route.LoaderArgs) {
  return loadPrivate(request, async () => {
    const options = serverApiOptions(request);
    const schedules = await readSchedules(options);
    const id =
      new URL(request.url).searchParams.get("scheduleId") || schedules[0]?.id;
    let view: ScheduleViewResponseBody | null = null;
    if (id && schedules.some((item) => item.id === id)) {
      try {
        view = await readSchedule(id, options);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    }
    return data(
      { schedules, view, year: new Date().getFullYear() },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = () => [{ title: "UWPlan - Schedule Courses" }];

const unavailable = (
  <p>You do not have access to this schedule, or the schedule is invalid.</p>
);

function ScheduleWorkspace({
  active,
  schedules,
  initial,
  year,
}: {
  active: ScheduleBody;
  schedules: ScheduleBody[];
  initial: ScheduleViewResponseBody | undefined;
  year: number;
}) {
  const result = useQuery({
    ...scheduleQuery(active.id),
    initialData: initial,
  });
  if (result.error instanceof ApiError && result.error.status === 404)
    return unavailable;
  if (!result.data)
    return (
      <>
        <ApiErrorMessage error={result.error} />
        {result.isPending && <p role="status">Loading schedule…</p>}
      </>
    );
  return (
    <div className="container mx-auto py-10">
      <h1 className="text-4xl font-bold tracking-tight text-primary">
        Schedule Your Courses
      </h1>
      <div className="space-y-6 py-10">
        <ApiErrorMessage error={result.error} />
        <TermRangeSelector range={result.data.term_range} year={year} />
        <ScheduleManagement schedules={schedules} active={active} />
        <div className="grid grid-cols-3 gap-4">
          {termLabels(result.data.term_range).map((term) => (
            <section
              key={term}
              aria-label={term}
              className="min-h-40 rounded-xl border bg-card p-6 shadow"
            >
              <h2 className="font-semibold">{term}</h2>
            </section>
          ))}
        </div>
      </div>
      <ScrollToTopButton />
    </div>
  );
}

export default function Schedule({ loaderData }: Route.ComponentProps) {
  const schedules = useQuery({
    ...schedulesQuery,
    initialData: loaderData.schedules,
  });
  const [params] = useSearchParams();
  const id = params.get("scheduleId") || schedules.data[0]?.id;
  const active = schedules.data.find((item) => item.id === id);
  if (!active) return unavailable;
  return (
    <>
      <ApiErrorMessage error={schedules.error} />
      <ScheduleWorkspace
        key={active.id}
        active={active}
        schedules={schedules.data}
        initial={
          loaderData.view?.schedule.id === active.id
            ? loaderData.view
            : undefined
        }
        year={loaderData.year}
      />
    </>
  );
}
