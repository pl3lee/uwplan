import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ApiErrorMessage } from "~/components/api-error";
import { Button } from "~/components/button";
import {
  RequirementCourses,
  SelectedCoursesTable,
} from "~/components/course-table";
import { ScrollToTopButton } from "~/components/scroll-to-top";
import { coursesQuery, templateQuery } from "~/lib/planning";
import { usePlanning } from "./planning";

// The authenticated layout supplies the user's plan. Load the catalog and
// definitions through the browser query cache, without serializing the full
// catalog into SSR HTML or a second React Router data response.
export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = () => [{ title: "UWPlan - Select Courses" }];

export default function Select() {
  const { plan } = usePlanning();
  const courses = useQuery(coursesQuery);
  const catalog = useMemo(
    () => ({
      byID: new Map((courses.data ?? []).map((course) => [course.id, course])),
      byCode: new Map(
        (courses.data ?? []).map((course) => [course.code, course]),
      ),
    }),
    [courses.data],
  );
  const definitions = useQueries({
    queries: (plan.template_ids ?? []).map(templateQuery),
  });
  const selected = new Set(plan.selected_course_ids ?? []);
  return (
    <div className="container mx-auto py-10">
      <h1 className="text-4xl font-bold tracking-tight text-primary">
        Select Your Courses
      </h1>
      <ApiErrorMessage error={courses.error} />
      {!courses.data ? (
        courses.isPending ? (
          <p role="status" className="mt-6">
            Loading courses…
          </p>
        ) : (
          <Button onClick={() => void courses.refetch()}>
            Retry loading courses
          </Button>
        )
      ) : (
        <>
          <section className="mt-6 rounded-xl border bg-card text-card-foreground shadow">
            <div className="p-6">
              <h2 className="text-lg font-medium">Your Selected Courses</h2>
            </div>
            <div className="px-6 pb-6">
              <SelectedCoursesTable
                courses={courses.data.filter((course) =>
                  selected.has(course.id),
                )}
              />
            </div>
          </section>
          {definitions.map((result, index) => {
            if (!result.data)
              return (
                <div key={plan.template_ids?.[index]} className="mt-6">
                  <ApiErrorMessage error={result.error} />
                  {result.isPending && (
                    <p role="status">Loading academic plan…</p>
                  )}
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
                            catalog={catalog}
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
        </>
      )}
      <ScrollToTopButton />
    </div>
  );
}
