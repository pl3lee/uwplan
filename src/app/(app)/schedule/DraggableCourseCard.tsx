"use client";

import { Card, CardContent } from "@/components/ui/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { type TermCourseInstance } from "@/types/schedule";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Info } from "lucide-react";

type Props = {
  id?: string;
  course: TermCourseInstance;
};

export function DraggableCourseCard({ id, course }: Props) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: id ?? course.courseId,
    data: course,
  });

  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing"
    >
      <CardContent className="relative p-4">
        <div className="absolute right-4 top-4">
          <HoverCard>
            <HoverCardTrigger>
              <Info className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </HoverCardTrigger>
            <HoverCardContent className="w-80">
              <div className="flex flex-col gap-2 text-sm">
                {course.courseDescription && (
                  <div>
                    <span className="font-medium">Description: </span>
                    <span className="text-muted-foreground">
                      {course.courseDescription}
                    </span>
                  </div>
                )}
                {course.coursePrereqs && (
                  <div>
                    <span className="font-medium">Prerequisites: </span>
                    <span className="text-muted-foreground">
                      {course.coursePrereqs}
                    </span>
                  </div>
                )}
                {course.courseAntireqs && (
                  <div>
                    <span className="font-medium">Antirequisites: </span>
                    <span className="text-muted-foreground">
                      {course.courseAntireqs}
                    </span>
                  </div>
                )}
                {course.courseCoreqs && (
                  <div>
                    <span className="font-medium">Corequisites: </span>
                    <span className="text-muted-foreground">
                      {course.courseCoreqs}
                    </span>
                  </div>
                )}
              </div>
            </HoverCardContent>
          </HoverCard>
        </div>
        <div className="font-medium">{course.courseCode}</div>
        <div className="text-sm text-muted-foreground">{course.courseName}</div>
      </CardContent>
    </Card>
  );
}
