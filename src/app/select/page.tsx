import styles from "@/styles/utils.module.css";
import { auth } from "@/server/auth";
import {
  getUserCourseSelections,
  getUserTemplateDetails,
} from "@/server/db/queries";
import { TemplateDisplay } from "@/components/TemplateDisplay";

export default async function SelectPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return <div>Please sign in</div>;
  }

  const [{ templates: userTemplates }, selections] = await Promise.all([
    getUserTemplateDetails(session.user.id),
    getUserCourseSelections(session.user.id),
  ]);

  // Add cache headers to prevent stale data
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");

  return (
    <div className="container mx-auto py-8">
      <div className={styles.pageTitle}>
        <h1 className={styles.pageTitleText}>Select Your Courses</h1>
      </div>
      <TemplateDisplay
        userTemplates={userTemplates}
        userId={session.user.id}
        initialSelections={selections}
      />
    </div>
  );
}
