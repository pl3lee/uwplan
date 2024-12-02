"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { type TermRange, type SelectedCourses } from "@/server/db/queries";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { DndContext, type DragEndEvent, useDroppable } from "@dnd-kit/core";
import { TermRangeSelector } from "./TermRangeSelector";
import { DraggableCourseCard } from "./DraggableCourseCard";
import { cn, generateTerms } from "@/lib/utils";
import { type Schedule, Term, type TermCourseInstance } from "@/types/schedule";
import {
  addCourseToScheduleAction,
  createScheduleAction,
  removeCourseFromScheduleAction,
  changeScheduleNameAction,
  deleteScheduleAction,
  changeTermRangeAction,
} from "@/server/actions";
import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Edit2, Plus, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { MobileScheduler } from "./MobileScheduler";

type Props = {
  coursesToSchedule: TermCourseInstance[];
  schedules: Schedule[];
  activeScheduleId: string;
  coursesInSchedule: TermCourseInstance[];
  termRange: TermRange;
};

function AddScheduleDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          Add Schedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Schedule</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Schedule name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
          />
          <Button
            onClick={async () => {
              if (name) {
                await createScheduleAction(name);
                setName("");
                setOpen(false);
              }
            }}
          >
            Create
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RenameScheduleDialog({
  scheduleId,
  currentName,
}: {
  scheduleId: string;
  currentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Edit2 className="mr-2 h-4 w-4" />
          Rename Schedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Schedule</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Input
            placeholder="Schedule name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
          />
          <Button
            onClick={async () => {
              if (name) {
                await changeScheduleNameAction(scheduleId, name);
                setOpen(false);
              }
            }}
          >
            Rename
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Scheduler({
  coursesToSchedule,
  schedules,
  activeScheduleId,
  coursesInSchedule,
  termRange,
}: Props) {
  const [startTerm, setStartTerm] = useState({
    season: termRange.startTerm,
    year: termRange.startYear,
  });
  const [endTerm, setEndTerm] = useState({
    season: termRange.endTerm,
    year: termRange.endYear,
  });

  const terms = generateTerms(startTerm, endTerm);

  const handleTermRangeChange = async (
    newStart: typeof startTerm,
    newEnd: typeof endTerm,
  ) => {
    setStartTerm(newStart);
    setEndTerm(newEnd);
    await changeTermRangeAction(
      newStart.season,
      newStart.year,
      newEnd.season,
      newEnd.year,
    );
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
        await removeCourseFromScheduleAction(
          activeScheduleId,
          active.id.toString(),
        );
      } catch (error) {
        console.error("Failed to remove course from term", error);
      }
    } else {
      try {
        await addCourseToScheduleAction(
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

  const router = useRouter();
  const activeSchedule = schedules.find((s) => s.id === activeScheduleId);

  return (
    <div className="container mx-auto py-10">
      <div className="space-y-6">
        <TermRangeSelector
          startTerm={startTerm}
          endTerm={endTerm}
          onStartTermChange={(term) => handleTermRangeChange(term, endTerm)}
          onEndTermChange={(term) => handleTermRangeChange(startTerm, term)}
        />

        {/* Schedule Management */}
        <div className="flex flex-col gap-2 md:flex-row">
          <AddScheduleDialog />
          {activeSchedule && (
            <>
              <RenameScheduleDialog
                scheduleId={activeScheduleId}
                currentName={activeSchedule.name}
              />
              <Button
                variant="destructive"
                onClick={async () => {
                  if (
                    confirm("Are you sure you want to delete this schedule?")
                  ) {
                    await deleteScheduleAction(activeScheduleId);
                    const nextSchedule = schedules.find(
                      (s) => s.id !== activeScheduleId,
                    );
                    router.push(
                      nextSchedule
                        ? `/schedule?scheduleId=${nextSchedule.id}`
                        : "/schedule",
                    );
                  }
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Schedule
              </Button>
            </>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex w-full flex-wrap gap-2">
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
        </div>

        {/* Mobile view */}
        <div className="md:hidden">
          <MobileScheduler
            coursesToSchedule={coursesToSchedule}
            coursesInSchedule={coursesInSchedule}
            activeScheduleId={activeScheduleId}
            terms={terms}
          />
        </div>

        {/* Desktop view with DnD */}
        <div className="hidden md:block">
          <DndContext onDragEnd={handleDragEnd}>
            <div className="grid grid-cols-[0.25fr,0.75fr] gap-6">
              <AvailableCourses courses={coursesToSchedule} />
              <div className="w-full space-y-4">
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
      </div>
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
