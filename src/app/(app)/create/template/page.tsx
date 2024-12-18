import styles from "@/styles/utils.module.css";
import { auth } from "@/server/auth";
import {
  getCoursesWithRatings,
  getTemplateForm,
  getTemplates,
} from "@/server/db/queries";
import { TemplateForm } from "./TemplateForm";
import { redirect } from "next/navigation";
import { type Metadata } from "next";
import { z } from "zod";

export const metadata: Metadata = {
  title: "UWPlan - Create Academic Plan",
};

const searchParamsSchema = z.object({
  templateId: z.string().default("none"),
});

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Props = {
  searchParams: SearchParams;
};

export default async function CreateTemplatePage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin");
  }

  const [searchParamsResolved, courses, templates] = await Promise.all([
    searchParams,
    getCoursesWithRatings(),
    getTemplates(),
  ]);
  const searchParamsResult = searchParamsSchema.parse(searchParamsResolved);

  console.log(searchParamsResult);

  const courseOptions = courses.map((course) => ({
    id: course.id,
    code: course.code,
  }));

  const selectedTemplateForm =
    searchParamsResult.templateId === "none"
      ? null
      : await getTemplateForm(searchParamsResult.templateId);

  console.log(selectedTemplateForm);

  return (
    <div className="container mx-auto py-10">
      <h1 className={styles.pageTitleText}>Create Academic Plan</h1>
      <p>
        Please read the following{" "}
        <span>
          <a
            href="https://docs.google.com/document/d/e/2PACX-1vS_LFzvKc6Ne0I4NXkIwkENpTFGZUVlyn_Fc5ZdGTljMVLc7o0KhOa_R5hP43jRMgzzGHOB5q6h47ZV/pub"
            target="_blank"
            className="text-blue-500 underline"
          >
            instructions
          </a>
        </span>{" "}
        for creating academic plans.
      </p>
      <TemplateForm courseOptions={courseOptions} templates={templates} />
    </div>
  );
}
