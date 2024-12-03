import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addCourseToScheduleAction,
  removeCourseFromScheduleAction,
} from "@/server/actions";
import { type Term, type TermCourseInstance } from "@/types/schedule";
import { Info } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Props = {
  coursesToSchedule: TermCourseInstance[];
  coursesInSchedule: TermCourseInstance[];
  activeScheduleId: string;
  terms: Term[];
};

function CourseInfoDialog({ course }: { course: TermCourseInstance }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Info className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{course.courseCode}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-4">
          {course.courseDescription && (
            <div>
              <div className="font-medium">Description</div>
              <div className="text-sm text-muted-foreground">
                {course.courseDescription}
              </div>
            </div>
          )}
          {course.coursePrereqs && (
            <div>
              <div className="font-medium">Prerequisites</div>
              <div className="text-sm text-muted-foreground">
                {course.coursePrereqs}
              </div>
            </div>
          )}
          {course.courseAntireqs && (
            <div>
              <div className="font-medium">Antirequisites</div>
              <div className="text-sm text-muted-foreground">
                {course.courseAntireqs}
              </div>
            </div>
          )}
          {course.courseCoreqs && (
            <div>
              <div className="font-medium">Corequisites</div>
              <div className="text-sm text-muted-foreground">
                {course.courseCoreqs}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CourseCard({
  course,
  activeScheduleId,
  terms,
}: {
  course: TermCourseInstance;
  activeScheduleId: string;
  terms: Term[];
}) {
  const [term, setTerm] = useState(course.term);
  const [pending, setPending] = useState(false);
  return (
    <Card key={course.courseId}>
      <CardHeader className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div>
              <p className="font-medium">
                {course.courseCode} <CourseInfoDialog course={course} />
              </p>
              <p className="text-sm text-muted-foreground">
                {course.courseName}
              </p>
            </div>
          </div>
          <Select
            value={term === "" ? "available" : term}
            disabled={pending}
            onValueChange={async (term) => {
              setPending(true);
              try {
                if (term === "available") {
                  setTerm("");
                  await removeCourseFromScheduleAction(
                    activeScheduleId,
                    course.courseId,
                  );
                } else {
                  setTerm(term);
                  await addCourseToScheduleAction(
                    activeScheduleId,
                    course.courseId,
                    term,
                  );
                }
              } catch (e) {
                toast.error("Failed to update course term");
                console.error(e);
              } finally {
                setPending(false);
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
  );
}

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
              <CourseCard
                key={course.courseId}
                course={course}
                activeScheduleId={activeScheduleId}
                terms={terms}
              />
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
                        <p className="font-medium">
                          {course.courseCode}{" "}
                          <CourseInfoDialog course={course} />
                        </p>
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
