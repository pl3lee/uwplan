"use client";

import { useState } from "react";
import { type SelectedCourses } from "@/server/db/queries";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Plus } from "lucide-react";
import { DndContext, DragEndEvent, useDroppable } from "@dnd-kit/core";
import { TermRangeSelector } from "./TermRangeSelector";
import { DraggableCourseCard } from "./DraggableCourseCard";
import { cn, generateTerms } from "@/lib/utils";
import { Schedule, Term } from "@/types/schedule";

type Props = {
  selectedCourses: SelectedCourses;
  schedules: Schedule[];
};

export function Scheduler({ selectedCourses, schedules }: Props) {
  const [startTerm, setStartTerm] = useState({ season: "Fall", year: 2023 });
  const [endTerm, setEndTerm] = useState({ season: "Spring", year: 2025 });

  const [activeSchedule, setActiveSchedule] = useState<string>(
    schedules.length > 0 && schedules[0] ? schedules[0].id : "",
  );

  const handleTermRangeChange = (
    newStart: typeof startTerm,
    newEnd: typeof endTerm,
  ) => {
    setStartTerm(newStart);
    setEndTerm(newEnd);
  };

  const currentSchedule = schedules.find((s) => s.id === activeSchedule);

  const addNewSchedule = () => {
    const newSchedule: Schedule = {
      id: `schedule-${schedules.length + 1}`,
      name: `Schedule ${schedules.length + 1}`,
      terms: generateTerms(startTerm, endTerm),
    };
    setSchedules([...schedules, newSchedule]);
    setActiveSchedule(newSchedule.id);
  };

  return (
    <div className="space-y-6">
      <TermRangeSelector
        startTerm={startTerm}
        endTerm={endTerm}
        onStartTermChange={(term) => handleTermRangeChange(term, endTerm)}
        onEndTermChange={(term) => handleTermRangeChange(startTerm, term)}
      />

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
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {schedules.map((schedule) => (
                <Button
                  key={schedule.id}
                  variant={
                    schedule.id === activeSchedule ? "default" : "outline"
                  }
                  onClick={() => setActiveSchedule(schedule.id)}
                >
                  {schedule.name}
                </Button>
              ))}
            </div>
            <Button onClick={addNewSchedule}>
              <Plus className="mr-2 h-4 w-4" />
              Add Schedule
            </Button>
          </div>

          <div className="grid max-h-[600px] grid-cols-3 gap-4 overflow-auto p-2">
            {currentSchedule?.terms.map((term) => (
              <TermBoard
                key={term.id}
                term={term}
                courses={selectedCourses.filter((c) =>
                  term.courses.includes(c.courseItemId),
                )}
              />
            ))}
          </div>
        </div>
      </div>
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
