import styles from "@/styles/utils.module.css";
import { Scheduler } from "@/components/Scheduler";
import { auth } from "@/server/auth";
import { getCoursesWithRatings, getSelectedCourses } from "@/server/db/queries";

export default async function SchedulePage() {
  const session = await auth();
  if (!session?.user) {
    return <div>Please sign in to view your requirements</div>;
  }
  const selectedCourses = await getSelectedCourses(session.user.id);
  console.log(selectedCourses);
  return (
    <div className="container mx-auto py-10">
      <h1 className={styles.pageTitleText}>Schedule Your Courses</h1>
      <Scheduler selectedCourses={selectedCourses} />
    </div>
  );
}
