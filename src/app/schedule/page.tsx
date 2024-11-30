import styles from "@/styles/utils.module.css";
import { Scheduler } from "@/components/Scheduler";
import { auth } from "@/server/auth";
import {
  getScheduleCourses,
  getSchedules,
  getSelectedCourses,
} from "@/server/db/queries";
import * as z from "zod";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Props = {
  searchParams: SearchParams;
};

export default async function SchedulePage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) {
    return <div>Please sign in to view your requirements</div>;
  }

  const schedulesSchema = z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        // Add other fields as necessary
      }),
    )
    .nonempty();

  const [selectedCourses, schedules] = await Promise.all([
    getSelectedCourses(session.user.id),
    schedulesSchema.parse(await getSchedules(session.user.id)),
  ]);

  // Validate and parse searchParams
  const searchParameters = await searchParams;
  const scheduleId = searchParameters.scheduleId;

  const activeScheduleId = scheduleId ? String(scheduleId) : schedules[0].id;
  console.log("scheduleId", activeScheduleId);
  const scheduleCourses = await getScheduleCourses(activeScheduleId);
  console.log("scheduleCourses", scheduleCourses);
  const coursesToSchedule = selectedCourses.filter((course) => {
    return !scheduleCourses.some(
      (scheduleCourse) => scheduleCourse.courseId === course.courseId,
    );
  });
  return (
    <div className="container mx-auto py-10">
      <h1 className={styles.pageTitleText}>Schedule Your Courses</h1>
      <Scheduler
        coursesToSchedule={coursesToSchedule}
        schedules={schedules}
        activeScheduleId={activeScheduleId}
        coursesInSchedule={scheduleCourses}
      />
    </div>
  );
}
