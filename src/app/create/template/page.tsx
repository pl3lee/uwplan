import styles from "@/styles/utils.module.css";
import { auth } from "@/server/auth";
import { getCoursesWithRatings } from "@/server/db/queries";
import { TemplateForm } from "./TemplateForm";

export default async function CreateTemplatePage() {
  const session = await auth();
  if (!session?.user) {
    return <div>Please sign in to create templates</div>;
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
