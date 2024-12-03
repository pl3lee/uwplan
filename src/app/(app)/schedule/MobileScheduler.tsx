import {
  addCourseToScheduleAction,
  removeCourseFromScheduleAction,
} from "@/server/actions";
import { type Term, type TermCourseInstance } from "@/types/schedule";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  coursesToSchedule: TermCourseInstance[];
  coursesInSchedule: TermCourseInstance[];
  activeScheduleId: string;
  terms: Term[];
};

export function MobileScheduler({
  coursesToSchedule,
  coursesInSchedule,
  activeScheduleId,
  terms,
}: Props) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Your Selected Courses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[...coursesToSchedule, ...coursesInSchedule]
            .sort((a, b) => a.courseCode.localeCompare(b.courseCode))
            .map((course) => (
              <Card key={course.courseId}>
                <CardHeader className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{course.courseCode}</p>
                      <p className="text-sm text-muted-foreground">
                        {course.courseName}
                      </p>
                    </div>
                    <Select
                      value={course.term === "" ? "available" : course.term}
                      onValueChange={async (term) => {
                        if (term === "available") {
                          await removeCourseFromScheduleAction(
                            activeScheduleId,
                            course.courseId,
                          );
                        } else {
                          await addCourseToScheduleAction(
                            activeScheduleId,
                            course.courseId,
                            term,
                          );
                        }
                      }}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue placeholder="Select term" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="available">Unscheduled</SelectItem>
                        {terms.map((term) => (
                          <SelectItem key={term.name} value={term.name}>
                            {term.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardHeader>
              </Card>
            ))}
        </CardContent>
      </Card>

      <div className="space-y-4">
        {terms.map((term) => {
          const termCourses = coursesInSchedule.filter(
            (course) => course.term === term.name,
          );
          if (termCourses.length === 0) return null;

          return (
            <Card key={term.name}>
              <CardHeader>
                <CardTitle>{term.name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {termCourses
                  .sort((a, b) => a.courseCode.localeCompare(b.courseCode))
                  .map((course) => (
                    <div
                      key={course.courseId}
                      className="flex items-center justify-between py-2"
                    >
                      <div>
                        <p className="font-medium">{course.courseCode}</p>
                        <p className="text-sm text-muted-foreground">
                          {course.courseName}
                        </p>
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
