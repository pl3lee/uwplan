import { useQueries, useQuery } from "@tanstack/react-query";
import { data } from "react-router";
import { ApiErrorMessage } from "~/components/api-error";
import {
  RequirementCourses,
  SelectedCoursesTable,
} from "~/components/course-table";
import { ScrollToTopButton } from "~/components/scroll-to-top";
import { serverApiOptions } from "~/lib/api.server";
import { loadPrivate } from "~/lib/auth.server";
import {
  coursesQuery,
  readCourses,
  readPlan,
  readTemplate,
  templateQuery,
} from "~/lib/planning";
import type { Route } from "./+types/select";
import { usePlanning } from "./planning";

export async function loader({ request }: Route.LoaderArgs) {
  return loadPrivate(request, async () => {
    const options = serverApiOptions(request);
    const [courses, plan] = await Promise.all([
      readCourses(options),
      readPlan(options),
    ]);
    const definitions = await Promise.all(
      (plan.template_ids ?? []).map((id) => readTemplate(id, options)),
    );
    return data(
      { courses, definitions },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = () => [{ title: "UWPlan - Select Courses" }];

export default function Select({ loaderData }: Route.ComponentProps) {
  const { plan } = usePlanning();
  const courses = useQuery({
    ...coursesQuery,
    initialData: loaderData.courses,
  });
  const definitions = useQueries({
    queries: (plan.template_ids ?? []).map((id) => ({
      ...templateQuery(id),
      initialData: loaderData.definitions.find(
        (value) => value.template.id === id,
      ),
    })),
  });
  const selected = new Set(plan.selected_course_ids ?? []);
  return (
    <div className="container mx-auto py-10">
      <h1 className="text-4xl font-bold tracking-tight text-primary">
        Select Your Courses
      </h1>
      <ApiErrorMessage error={courses.error} />
      <section className="mt-6 rounded-xl border bg-card text-card-foreground shadow">
        <div className="p-6">
          <h2 className="text-lg font-medium">Your Selected Courses</h2>
        </div>
        <div className="px-6 pb-6">
          <SelectedCoursesTable
            courses={courses.data.filter((course) => selected.has(course.id))}
          />
        </div>
      </section>
      {definitions.map((result, index) => {
        if (!result.data)
          return (
            <div key={plan.template_ids?.[index]} className="mt-6">
              <ApiErrorMessage error={result.error} />
              {result.isPending && <p role="status">Loading academic plan…</p>}
            </div>
          );
        const definition = result.data;
        return (
          <section
            key={definition.template.id}
            className="mt-6 rounded-xl border bg-card text-card-foreground shadow"
          >
            <div className="p-6">
              <h2 className="text-lg font-medium">
                {definition.template.name}
              </h2>
              <p className="text-sm text-muted-foreground">
                {definition.template.description}
              </p>
            </div>
            <div className="px-6 pb-6">
              <ApiErrorMessage error={result.error} />
              {(definition.items ?? []).map((item) => (
                <div key={item.id} className="mt-6">
                  {item.type === "requirement" && (
                    <>
                      <h3 className="mb-2 text-card-foreground">
                        {item.description}
                      </h3>
                      <RequirementCourses
                        slots={item.courses ?? []}
                        courses={courses.data}
                        plan={plan}
                      />
                    </>
                  )}
                  {item.type === "instruction" && (
                    <h3 className="mb-2 text-lg font-medium text-accent-foreground">
                      {item.description}
                    </h3>
                  )}
                  {item.type === "separator" && (
                    <hr className="mt-8 h-2 border-0 bg-gradient-to-r from-primary/5 via-primary/30 to-primary/5" />
                  )}
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <ScrollToTopButton />
    </div>
  );
}
