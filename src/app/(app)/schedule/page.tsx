import styles from "@/styles/utils.module.css";
import { Scheduler } from "@/app/(app)/schedule/Scheduler";
import { auth } from "@/server/auth";
import {
  getScheduleCourses,
  getSchedules,
  getSelectedCourses,
  getTermRange,
  type TermRange,
  validateScheduleId,
} from "@/server/db/queries";
import * as z from "zod";
import { ScrollToTopButton } from "@/components/nav/ScrollToTopButton";
import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type Props = {
  searchParams: SearchParams;
};

const selectedCoursesSchema = z.array(
  z.object({
    courseItemId: z.string(),
    courseId: z.string().min(1),
    courseCode: z.string(),
    courseName: z.string(),
  }),
);
const schedulesSchema = z
  .array(
    z.object({
      id: z.string(),
      name: z.string(),
    }),
  )
  .nonempty();

export default async function SchedulePage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin");
  }

  const [selectedCourses, schedules] = await Promise.all([
    selectedCoursesSchema.parse(await getSelectedCourses(session.user.id)),
    schedulesSchema.parse(await getSchedules(session.user.id)),
  ]);

  // Validate and parse searchParams
  const searchParameters = await searchParams;
  const scheduleId = searchParameters.scheduleId;

  const activeScheduleId = scheduleId ? String(scheduleId) : schedules[0].id;
  const scheduleIsValid = await validateScheduleId(
    session.user.id,
    activeScheduleId,
  );
  if (!scheduleIsValid) {
    return (
      <div>
        You do not have access to this schedule, or the schedule is invalid.
      </div>
    );
  }
  const scheduleCourses = await getScheduleCourses(activeScheduleId);
  const coursesToSchedule = Array.from(
    new Map(
      selectedCourses
        .filter((course) => {
          return !scheduleCourses.some(
            (scheduleCourse) => scheduleCourse.courseId === course.courseId,
          );
        })
        .map((course) => [
          course.courseId,
          {
            courseId: course.courseId,
            courseCode: course.courseCode,
            courseName: course.courseName,
            term: "",
          },
        ]),
    ).values(),
  );

  const termRange: TermRange = await getTermRange(session.user.id);
  return (
    <div className="container mx-auto py-10">
      <h1 className={styles.pageTitleText}>Schedule Your Courses</h1>
      <Scheduler
        coursesToSchedule={coursesToSchedule}
        schedules={schedules}
        activeScheduleId={activeScheduleId}
        coursesInSchedule={scheduleCourses}
        termRange={termRange}
      />
      <ScrollToTopButton />
    </div>
  );
}
