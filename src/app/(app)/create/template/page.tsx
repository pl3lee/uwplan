import styles from "@/styles/utils.module.css";
import { auth } from "@/server/auth";
import { getCoursesWithRatings, getTemplateForms } from "@/server/db/queries";
import { formSchema, TemplateForm } from "./TemplateForm";
import { redirect } from "next/navigation";
import { type Metadata } from "next";

export const metadata: Metadata = {
  title: "UWPlan - Create Academic Plan",
};

export default async function CreateTemplatePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin");
  }

  const courses = await getCoursesWithRatings();
  const courseOptions = courses.map((course) => ({
    id: course.id,
    code: course.code,
  }));

  const templateForms = await getTemplateForms();
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
      <TemplateForm
        courseOptions={courseOptions}
        templateForms={templateForms}
      />
    </div>
  );
}
