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
import { addSchedule } from "@/server/actions";

type Props = {
  selectedCourses: SelectedCourses;
  schedules: Schedule[];
  activeScheduleId: string;
};

export function Scheduler({
  selectedCourses,
  schedules,
  activeScheduleId,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) return;

    const courseItemId = (active.data.current as { courseItemId: string })
      ?.courseItemId;
    const termId = over.id as string;

    // Remove from all terms first
    const newTermInstances = { ...termInstances };
    Object.keys(newTermInstances).forEach((key) => {
      newTermInstances[key] = newTermInstances[key].filter(
        (instance) => instance.courseItemId !== courseItemId,
      );
    });

    // Add to new term
    if (!newTermInstances[termId]) {
      newTermInstances[termId] = [];
    }

    newTermInstances[termId].push({
      instanceId: `${courseItemId}-${termId}`,
      courseItemId,
    });

    setTermInstances(newTermInstances);
  };

  const handleScheduleChange = (scheduleId: string) => {
    router.push(`${pathname}?schedule=${scheduleId}`);
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
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Available Courses</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {selectedCourses.map((course) => (
                  <DraggableCourseCard
                    key={course.courseItemId}
                    course={course}
                  />
                ))}
              </CardContent>
            </Card>
          </div>

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
                    onClick={() => handleScheduleChange(schedule.id)}
                  >
                    {schedule.name}
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

            <div className="grid h-full max-w-full grid-cols-3 gap-4 p-2">
              {terms.map((term) => (
                <TermBoard
                  key={term.id}
                  term={{
                    ...term,
                    courses: termInstances[term.id] || [],
                  }}
                  courses={selectedCourses}
                />
              ))}
            </div>
          </div>
        </div>
      </DndContext>
    </div>
  );
}

// Update TermBoard to use CourseInstance
function TermBoard({
  term,
  courses,
}: {
  term: Term;
  courses: SelectedCourses;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: term.id,
    data: term,
  });

  return (
    <Card
      ref={setNodeRef}
      className={cn(
        "transition-colors",
        isOver && "ring-2 ring-primary ring-offset-2",
        // "min-w-[300px]",
      )}
    >
      <CardHeader>
        <CardTitle>{term.name}</CardTitle>
      </CardHeader>
      <CardContent
        className={cn("min-h-[100px] space-y-2", isOver && "bg-muted/50")}
      >
        {term.courses.map((instance) => {
          const course = courses.find(
            (c) => c.courseItemId === instance.courseItemId,
          );
          if (!course) return null;
          return (
            <DraggableCourseCard
              key={instance.instanceId}
              id={instance.instanceId}
              course={course}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}
