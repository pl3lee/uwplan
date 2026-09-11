import { data } from "react-router";
import { TemplateEditor } from "~/components/template-editor";
import { serverApiOptions } from "~/lib/api.server";
import { loadPrivate } from "~/lib/auth.server";
import { readCourses } from "~/lib/planning";
import type { Route } from "./+types/create-template";

export async function loader({ request }: Route.LoaderArgs) {
  return loadPrivate(request, async () =>
    data(
      { courses: await readCourses(serverApiOptions(request)) },
      { headers: { "Cache-Control": "no-store" } },
    ),
  );
}
export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = () => [{ title: "UWPlan - Create Academic Plan" }];
export default function CreateTemplate({ loaderData }: Route.ComponentProps) {
  return (
    <div className="container mx-auto py-10">
      <h1 className="text-4xl font-bold tracking-tight text-primary">
        Create Academic Plan
      </h1>
      <p>
        Please read the following{" "}
        <a
          href="https://docs.google.com/document/d/e/2PACX-1vS_LFzvKc6Ne0I4NXkIwkENpTFGZUVlyn_Fc5ZdGTljMVLc7o0KhOa_R5hP43jRMgzzGHOB5q6h47ZV/pub"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 underline"
        >
          instructions
        </a>{" "}
        for creating academic plans.
      </p>
      <TemplateEditor courses={loaderData.courses} />
    </div>
  );
}
