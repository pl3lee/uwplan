"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { type SelectedCourses } from "@/server/db/queries";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Plus } from "lucide-react";
import { DndContext, DragEndEvent, useDroppable } from "@dnd-kit/core";
import { TermRangeSelector } from "./TermRangeSelector";
import { DraggableCourseCard } from "./DraggableCourseCard";
import { cn, generateTerms } from "@/lib/utils";
import { Schedule, Term, TermCourseInstance } from "@/types/schedule";
import {
  addCourseToTerm,
  addSchedule,
  removeCourseFromTerm,
} from "@/server/actions";
import Link from "next/link";

type Props = {
  coursesToSchedule: TermCourseInstance[];
  schedules: Schedule[];
  activeScheduleId: string;
  coursesInSchedule: TermCourseInstance[];
};

export function Scheduler({
  coursesToSchedule,
  schedules,
  activeScheduleId,
  coursesInSchedule,
}: Props) {
  const [startTerm, setStartTerm] = useState({ season: "Fall", year: 2023 });
  const [endTerm, setEndTerm] = useState({ season: "Spring", year: 2025 });

  const terms = generateTerms(startTerm, endTerm);

  const handleTermRangeChange = (
    newStart: typeof startTerm,
    newEnd: typeof endTerm,
  ) => {
    setStartTerm(newStart);
    setEndTerm(newEnd);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    // active contains the course id
    // over contains the term name
    const { active, over } = event;

    if (!over) return;
    console.log("active", active);
    console.log("over", over);
    if (over.id.toString() === "available") {
      try {
        await removeCourseFromTerm(activeScheduleId, active.id.toString());
      } catch (error) {
        console.error("Failed to remove course from term", error);
      }
    } else {
      try {
        await addCourseToTerm(
          activeScheduleId,
          active.id.toString(),
          over.id.toString(),
        );
        console.log("Added course to term");
      } catch (error) {
        console.error("Failed to add course to term", error);
      }
    }
  };

  return (
    <div className="space-y-6">
      <TermRangeSelector
        startTerm={startTerm}
        endTerm={endTerm}
        onStartTermChange={(term) => handleTermRangeChange(term, endTerm)}
        onEndTermChange={(term) => handleTermRangeChange(startTerm, term)}
      />

      <DndContext onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-[300px,1fr] gap-6">
          {/* Left side - Course list */}
          <AvailableCourses courses={coursesToSchedule} />

          {/* Right side - Term boards */}
          <div className="w-full space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {schedules.map((schedule) => (
                  <Button
                    key={schedule.id}
                    variant={
                      schedule.id === activeScheduleId ? "default" : "outline"
                    }
                    asChild
                  >
                    <Link href={`/schedule?scheduleId=${schedule.id}`}>
                      {schedule.name}
                    </Link>
                  </Button>
                ))}
              </div>
              <Button
                onClick={async () =>
                  addSchedule(`Schedule ${schedules.length + 1}`)
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Schedule
              </Button>
            </div>

            <div className="grid h-min max-w-full grid-cols-3 gap-4 p-2">
              {terms.map((term) => (
                <TermBoard
                  key={term.name}
                  name={term.name}
                  courses={coursesInSchedule.filter(
                    (course) => course.term === term.name,
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </DndContext>
    </div>
  );
}

function AvailableCourses({ courses }: { courses: TermCourseInstance[] }) {
  const { setNodeRef, isOver } = useDroppable({
    id: "available",
  });

  return (
    <div ref={setNodeRef} className="h-full">
      <Card
        className={cn(
          "h-full transition-shadow",
          isOver && "ring-2 ring-primary ring-offset-2",
        )}
      >
        <CardHeader>
          <CardTitle>Available Courses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {courses.map((course) => (
            <DraggableCourseCard key={course.courseId} course={course} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function TermBoard({
  name,
  courses,
}: {
  name: string;
  courses: TermCourseInstance[];
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: name,
  });

  return (
    <div ref={setNodeRef} className="h-full">
      <Card
        className={cn(
          "h-full transition-shadow",
          isOver && "ring-2 ring-primary ring-offset-2",
        )}
      >
        <CardHeader>
          <CardTitle>{name}</CardTitle>
        </CardHeader>
        <CardContent className={cn("min-h-[100px] space-y-2")}>
          {courses.map((instance) => (
            <DraggableCourseCard
              key={instance.courseId}
              id={instance.courseId}
              course={instance}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
