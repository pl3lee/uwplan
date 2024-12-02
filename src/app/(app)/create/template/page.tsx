import styles from "@/styles/utils.module.css";
import { auth } from "@/server/auth";
import { getCoursesWithRatings } from "@/server/db/queries";
import { TemplateForm } from "./TemplateForm";
import { redirect } from "next/navigation";

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

  return (
    <div className="container mx-auto py-10">
      <h1 className={styles.pageTitleText}>Create Template</h1>
      <TemplateForm courseOptions={courseOptions} />
    </div>
  );
}
