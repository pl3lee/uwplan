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
import { type Metadata } from "next";

export const metadata: Metadata = {
  title: "UWPlan - Schedule Courses",
};

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
    courseDescription: z.string(),
    courseAntireqs: z.string(),
    coursePrereqs: z.string(),
    courseCoreqs: z.string(),
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

  const [selectedCourses, schedules, termRange, searchParameters] =
    await Promise.all([
      selectedCoursesSchema.parse(await getSelectedCourses(session.user.id)),
      schedulesSchema.parse(await getSchedules(session.user.id)),
      getTermRange(session.user.id),
      searchParams,
    ]);

  const scheduleId = searchParameters.scheduleId;

  const activeScheduleId = scheduleId ? String(scheduleId) : schedules[0].id;
  const [scheduleIsValid, scheduleCourses] = await Promise.all([
    validateScheduleId(session.user.id, activeScheduleId),
    getScheduleCourses(activeScheduleId),
  ]);
  if (!scheduleIsValid) {
    return (
      <div>
        You do not have access to this schedule, or the schedule is invalid.
      </div>
    );
  }
  const sortedScheduleCourses = scheduleCourses.sort((a, b) =>
    a.courseCode.localeCompare(b.courseCode),
  );
  const coursesToSchedule = Array.from(
    new Map(
      selectedCourses
        .filter((course) => {
          return !sortedScheduleCourses.some(
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
            courseDescription: course.courseDescription,
            courseAntireqs: course.courseAntireqs,
            coursePrereqs: course.coursePrereqs,
            courseCoreqs: course.courseCoreqs,
          },
        ]),
    ).values(),
  ).sort((a, b) => a.courseCode.localeCompare(b.courseCode));
  return (
    <div className="container mx-auto py-10">
      <h1 className={styles.pageTitleText}>Schedule Your Courses</h1>
      <Scheduler
        coursesToSchedule={coursesToSchedule}
        schedules={schedules}
        activeScheduleId={activeScheduleId}
        coursesInSchedule={sortedScheduleCourses}
        termRange={termRange}
      />
      <ScrollToTopButton />
    </div>
  );
}
