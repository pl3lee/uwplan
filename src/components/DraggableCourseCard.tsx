"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "./ui/card";
import { type SelectedCourses } from "@/server/db/queries";

type Props = {
  id?: string; // Optional ID for term instances
  course: SelectedCourses[number];
};

export function DraggableCourseCard({ id, course }: Props) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: id ?? course.courseItemId,
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
