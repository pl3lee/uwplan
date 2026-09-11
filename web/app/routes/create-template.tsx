import { data, useLocation } from "react-router";
import {
  TemplateEditor,
  type TemplateEditorValues,
} from "~/components/template-editor";
import { TemplatePicker } from "~/components/template-picker";
import type { TemplateDefinitionResponseBody } from "~/generated/api/model";
import { serverApiOptions } from "~/lib/api.server";
import { ApiError } from "~/lib/api-fetch";
import { loadPrivate } from "~/lib/auth.server";
import { readCourses, readTemplate, readTemplates } from "~/lib/planning";
import type { Route } from "./+types/create-template";

function copiedValues(
  definition: TemplateDefinitionResponseBody,
): TemplateEditorValues {
  return {
    name: definition.template.name,
    description: definition.template.description ?? "",
    items: (definition.items ?? []).map((item) => ({
      id: item.id,
      kind:
        item.type === "requirement"
          ? (item.courses?.[0]?.type ?? "free")
          : item.type,
      description: item.description ?? "",
      codes: (item.courses ?? [])
        .map((course) => course.course_code ?? "")
        .join(", "),
      count: item.courses?.length ?? 0,
    })),
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  return loadPrivate(request, async () => {
    const options = serverApiOptions(request);
    const [courses, templates] = await Promise.all([
      readCourses(options),
      readTemplates(options),
    ]);
    const templateId =
      new URL(request.url).searchParams.get("templateId") || "none";
    let initial: TemplateEditorValues | undefined;
    let unavailable = false;
    if (templateId !== "none") {
      if (!templates.some((template) => template.id === templateId))
        unavailable = true;
      else {
        try {
          initial = copiedValues(await readTemplate(templateId, options));
        } catch (error) {
          if (error instanceof ApiError && error.status === 404)
            unavailable = true;
          else throw error;
        }
      }
    }
    return data(
      { courses, templates, templateId, initial, unavailable },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
export const headers = () => ({ "Cache-Control": "no-store" });
export const meta = () => [{ title: "UWPlan - Create Academic Plan" }];
export default function CreateTemplate({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
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
      {loaderData.unavailable && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          This academic plan is unavailable. Choose another plan to copy.
        </p>
      )}
      <TemplateEditor
        key={location.key}
        courses={loaderData.courses}
        initial={loaderData.initial}
        copyControl={
          <TemplatePicker
            templates={loaderData.templates}
            selectedId={loaderData.templateId}
          />
        }
      />
    </div>
  );
}
