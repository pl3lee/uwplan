"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { cn, generateTerms } from "@/lib/utils";
import {
  addCourseToScheduleAction,
  changeScheduleNameAction,
  changeTermRangeAction,
  createScheduleAction,
  deleteScheduleAction,
  removeCourseFromScheduleAction,
} from "@/server/actions";
import { type TermRange } from "@/server/db/queries";
import { type Schedule, type TermCourseInstance } from "@/types/schedule";
import { DndContext, type DragEndEvent, useDroppable } from "@dnd-kit/core";
import { Edit2, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DraggableCourseCard } from "./DraggableCourseCard";
import { MobileScheduler } from "./MobileScheduler";
import { TermRangeSelector } from "./TermRangeSelector";
import { toast } from "sonner";
import { ExportButton } from "./ExportButton";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const scheduleFormSchema = z.object({
  name: z
    .string()
    .min(1, {
      message: "Schedule name is required.",
    })
    .max(20, {
      message: "Schedule name cannot be longer than 20 characters.",
    }),
});

type Props = {
  coursesToSchedule: TermCourseInstance[];
  schedules: Schedule[];
  activeScheduleId: string;
  coursesInSchedule: TermCourseInstance[];
  termRange: TermRange;
};

type ToScheduleOptimisticValue = {
  operation: "add" | "remove";
  courseId: string;
};

type InScheduleOptimisticValue = {
  operation: "add" | "remove";
  courseId: string;
  term: string;
};

function AddScheduleDialog() {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const form = useForm<z.infer<typeof scheduleFormSchema>>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      name: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof scheduleFormSchema>) => {
    setIsLoading(true);
    try {
      await createScheduleAction(values.name);
      form.reset();
      setOpen(false);
      toast.success("Schedule created");
    } catch (error) {
      console.error("Failed to create schedule", error);
      toast.error("Failed to create schedule");
    } finally {
      setIsLoading(false);
    }
  };

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
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Schedule Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Schedule name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Creating..." : "Create"}
            </Button>
          </form>
        </Form>
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
  const [isLoading, setIsLoading] = useState(false);
  const form = useForm<z.infer<typeof scheduleFormSchema>>({
    resolver: zodResolver(scheduleFormSchema),
    defaultValues: {
      name: "",
    },
  });

  const onSubmit = async (values: z.infer<typeof scheduleFormSchema>) => {
    setIsLoading(true);
    try {
      await changeScheduleNameAction(scheduleId, values.name);
      form.reset();
      setOpen(false);
      toast.success("Schedule renamed");
    } catch (error) {
      console.error("Failed to rename schedule", error);
      toast.error("Failed to rename schedule");
    } finally {
      setIsLoading(false);
    }
  };

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
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Name</FormLabel>
                  <FormControl>
                    <Input placeholder={currentName} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isLoading}>
              {isLoading ? "Renaming..." : "Rename"}
            </Button>
          </form>
        </Form>
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
  const router = useRouter();
  const terms = generateTerms(startTerm, endTerm);
  const [_, startTransition] = useTransition();
  const activeSchedule = schedules.find((s) => s.id === activeScheduleId);
  const [optimisticCoursesToSchedule, setOptimisticCoursesToSchedule] =
    useOptimistic(
      coursesToSchedule,
      (
        currentCoursesToSchedule,
        optimisticValue: ToScheduleOptimisticValue,
      ) => {
        const newState = [...currentCoursesToSchedule];

        if (optimisticValue.operation === "add") {
          const newCourse = coursesInSchedule.find(
            (course) => course.courseId === optimisticValue.courseId,
          );
          if (newCourse) {
            newState.push({ ...newCourse, term: "available" });
          }
        } else {
          const index = newState.findIndex(
            (course) => course.courseId === optimisticValue.courseId,
          );
          if (index !== -1) {
            newState.splice(index, 1);
          }
        }
        return newState.sort((a, b) =>
          a.courseCode.localeCompare(b.courseCode),
        );
      },
    );
  const [optimisticCoursesInSchedule, setOptimisticCoursesInSchedule] =
    useOptimistic(
      coursesInSchedule,
      (
        currentCoursesInSchedule,
        optimisticValue: InScheduleOptimisticValue,
      ) => {
        const newState = [...currentCoursesInSchedule];

        if (optimisticValue.operation === "add") {
          const newCourseInToSchedule = coursesToSchedule.find(
            (course) => course.courseId === optimisticValue.courseId,
          );
          if (newCourseInToSchedule) {
            newState.push({
              ...newCourseInToSchedule,
              term: optimisticValue.term,
            });
          } else {
            const newCourse = coursesInSchedule.find(
              (course) => course.courseId === optimisticValue.courseId,
            );
            if (newCourse) {
              newState.push({ ...newCourse, term: optimisticValue.term });
            }
          }
        } else {
          const index = newState.findIndex(
            (course) => course.courseId === optimisticValue.courseId,
          );
          if (index !== -1) {
            newState.splice(index, 1);
          }
        }
        return newState.sort((a, b) =>
          a.courseCode.localeCompare(b.courseCode),
        );
      },
    );

  const handleTermRangeChange = async (
    newStart: typeof startTerm,
    newEnd: typeof endTerm,
  ) => {
    setStartTerm(newStart);
    setEndTerm(newEnd);
    try {
      await changeTermRangeAction(
        newStart.season,
        newStart.year,
        newEnd.season,
        newEnd.year,
      );
    } catch (error) {
      console.error("Failed to change term range", error);
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    // active contains the course id
    // over contains the term name
    const { active, over } = event;

    if (!over) return;
    if (over.id.toString() === "available") {
      try {
        startTransition(() => {
          setOptimisticCoursesToSchedule({
            operation: "add",
            courseId: active.id.toString(),
          });
          setOptimisticCoursesInSchedule({
            operation: "remove",
            courseId: active.id.toString(),
            term: "",
          });
        });
        await removeCourseFromScheduleAction(
          activeScheduleId,
          active.id.toString(),
        );
      } catch (error) {
        console.error("Failed to remove course from term", error);
      }
    } else {
      try {
        startTransition(() => {
          // find origin of course
          const origin = optimisticCoursesInSchedule.find(
            (course) => course.courseId === active.id.toString(),
          );
          if (origin) {
            setOptimisticCoursesInSchedule({
              operation: "remove",
              courseId: active.id.toString(),
              term: origin.term,
            });
          } else {
            setOptimisticCoursesToSchedule({
              operation: "remove",
              courseId: active.id.toString(),
            });
          }
          console.log(over.id.toString());
          setOptimisticCoursesInSchedule({
            operation: "add",
            courseId: active.id.toString(),
            term: over.id.toString(),
          });
        });
        await addCourseToScheduleAction(
          activeScheduleId,
          active.id.toString(),
          over.id.toString(),
        );
      } catch (error) {
        console.error("Failed to add course to term", error);
      }
    }
  };

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
              <ExportButton scheduleId={activeScheduleId} />
              <Button
                variant="destructive"
                disabled={schedules.length <= 1}
                onClick={async () => {
                  if (
                    confirm("Are you sure you want to delete this schedule?")
                  ) {
                    try {
                      await deleteScheduleAction(activeScheduleId);
                      const nextSchedule = schedules.find(
                        (s) => s.id !== activeScheduleId,
                      );
                      toast.success("Schedule deleted");
                      router.push(
                        nextSchedule
                          ? `/schedule?scheduleId=${nextSchedule.id}`
                          : "/schedule",
                      );
                    } catch (error) {
                      console.error("Failed to delete schedule", error);
                      toast.error("Failed to delete schedule");
                    }
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
        <div className="lg:hidden">
          <MobileScheduler
            coursesToSchedule={optimisticCoursesToSchedule}
            coursesInSchedule={optimisticCoursesInSchedule}
            activeScheduleId={activeScheduleId}
            terms={terms}
          />
        </div>

        {/* Desktop view with DnD */}
        <div className="hidden lg:block">
          <DndContext onDragEnd={handleDragEnd}>
            <div className="grid grid-cols-[0.25fr,0.75fr] gap-6">
              <AvailableCourses courses={optimisticCoursesToSchedule} />
              <div className="w-full space-y-4">
                <div className="grid h-min max-w-full grid-cols-3 gap-4 p-2">
                  {terms.map((term) => (
                    <TermBoard
                      key={term.name}
                      name={term.name}
                      courses={optimisticCoursesInSchedule.filter(
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
