import styles from "@/styles/utils.module.css";
import { Scheduler } from "@/components/Scheduler";
import { auth } from "@/server/auth";
import {
  getCoursesWithRatings,
  getSchedules,
  getSelectedCourses,
} from "@/server/db/queries";

export default async function SchedulePage() {
  const session = await auth();
  if (!session?.user) {
    return <div>Please sign in to view your requirements</div>;
  }
  const [selectedCourses, schedules] = await Promise.all([
    getSelectedCourses(session.user.id),
    getSchedules(session.user.id),
  ]);
  console.log(selectedCourses);
  return (
    <div className="container mx-auto py-10">
      <h1 className={styles.pageTitleText}>Schedule Your Courses</h1>
      <Scheduler selectedCourses={selectedCourses} schedules={schedules} />
    </div>
  );
}
