import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { type Course } from "@/types/course";
import Link from "next/link";

type Props = {
  course: Course;
};

export function CourseHoverLink({ course }: Props) {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Button asChild variant="link" className="text-blue-600">
          <Link
            href={`https://uwflow.com/course/${course.code}`}
            target="_blank"
          >
            {course.code}
          </Link>
        </Button>
      </HoverCardTrigger>
      <HoverCardContent className="w-80">
        <div className="flex flex-col gap-2 text-sm">
          {course.description && (
            <div>
              <span className="font-medium">Description: </span>
              <span className="text-muted-foreground">
                {course.description}
              </span>
            </div>
          )}
          {course.prereqs && (
            <div>
              <span className="font-medium">Prerequisites: </span>
              <span className="text-muted-foreground">{course.prereqs}</span>
            </div>
          )}
          {course.antireqs && (
            <div>
              <span className="font-medium">Antirequisites: </span>
              <span className="text-muted-foreground">{course.antireqs}</span>
            </div>
          )}
          {course.coreqs && (
            <div>
              <span className="font-medium">Corequisites: </span>
              <span className="text-muted-foreground">{course.coreqs}</span>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
