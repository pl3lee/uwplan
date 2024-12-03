"use client";

import { type TermCourseInstance } from "@/types/schedule";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";

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
      <CardContent className="p-4">
        <div className="font-medium">{course.courseCode}</div>
        <div className="text-sm text-muted-foreground">{course.courseName}</div>
      </CardContent>
    </Card>
  );
}
