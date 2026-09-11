import { Dialog } from "@base-ui/react/dialog";
import { PreviewCard } from "@base-ui/react/preview-card";
import { DndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import {
  assignScheduleCourse,
  removeScheduleCourse,
} from "~/generated/api/client";
import type {
  CourseBody,
  ScheduleViewResponseBody,
} from "~/generated/api/model";
import { usePlanningMutation } from "~/lib/planning-mutation";
import { cn } from "~/lib/utils";
import { ApiErrorMessage } from "./api-error";
import { Button } from "./button";
import { SelectField } from "./select-field";
import { termLabels } from "./term-range";

function CourseDetails({ course }: { course: CourseBody }) {
  return (
    <div className="space-y-2 text-sm">
      {[
        ["Description", course.description],
        ["Prerequisites", course.prereqs],
        ["Antirequisites", course.antireqs],
        ["Corequisites", course.coreqs],
      ].map(
        ([label, value]) =>
          value && (
            <div key={label}>
              <span className="font-medium">{label}: </span>
              <span className="text-muted-foreground">{value}</span>
            </div>
          ),
      )}
    </div>
  );
}

function CourseInfoDialog({ course }: { course: CourseBody }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        render={<Button variant="ghost" size="icon" />}
        aria-label={`Information about ${course.name}`}
      >
        ⓘ
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg border bg-background p-6 shadow-lg">
          <Dialog.Title className="text-lg font-semibold">
            {course.code}
          </Dialog.Title>
          <CourseDetails course={course} />
          <Dialog.Close render={<Button variant="outline" />}>
            Close
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DraggableCourse({
  course,
  disabled,
}: {
  course: CourseBody;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: course.id, disabled });
  return (
    <div className="relative">
      <button
        type="button"
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        disabled={disabled}
        style={
          transform
            ? {
                transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
                position: "relative",
                zIndex: 10,
              }
            : undefined
        }
        className={cn(
          "w-full cursor-grab rounded-xl border bg-card p-4 text-left shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
          isDragging && "opacity-75",
        )}
      >
        <span className="block pr-5 font-medium">{course.code}</span>
        <span className="block text-sm text-muted-foreground">
          {course.name}
        </span>
      </button>
      <PreviewCard.Root>
        <PreviewCard.Trigger
          render={
            <button
              type="button"
              aria-label={`Information about ${course.name}`}
            />
          }
          className="absolute right-3 top-3 text-muted-foreground"
        >
          ⓘ
        </PreviewCard.Trigger>
        <PreviewCard.Portal>
          <PreviewCard.Positioner sideOffset={4} className="z-50">
            <PreviewCard.Popup className="w-80 rounded-md border bg-popover p-4 shadow-md">
              <CourseDetails course={course} />
            </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>
    </div>
  );
}

function TermBoard({
  name,
  id = name,
  courses,
  disabled,
}: {
  name: string;
  id?: string;
  courses: CourseBody[];
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });
  return (
    <section
      ref={setNodeRef}
      aria-label={name}
      className={cn(
        "h-full rounded-xl border bg-card text-card-foreground shadow transition-shadow",
        isOver && "ring-2 ring-primary ring-offset-2",
      )}
    >
      <h2 className="p-6 text-lg font-semibold">{name}</h2>
      <div className="min-h-25 space-y-2 px-6 pb-6">
        {courses.map((course) => (
          <DraggableCourse
            key={course.id}
            course={course}
            disabled={disabled}
          />
        ))}
      </div>
    </section>
  );
}

export function CourseScheduler({ view }: { view: ScheduleViewResponseBody }) {
  const mutation = usePlanningMutation(`schedule:${view.schedule.id}`);
  const terms = termLabels(view.term_range);
  const assigned = view.assigned ?? [];
  const selected = [
    ...new Map(
      (view.selected ?? []).map((course) => [course.id, course]),
    ).values(),
  ];
  const sort = (courses: CourseBody[]) =>
    courses.sort((a, b) => a.code.localeCompare(b.code));
  const available = sort(
    selected.filter(
      (course) => !assigned.some((item) => item.course.id === course.id),
    ),
  );
  const allCourses = sort([
    ...new Map(
      [...selected, ...assigned.map((item) => item.course)].map((course) => [
        course.id,
        course,
      ]),
    ).values(),
  ]);
  const changeTerm = (courseId: string, term: string) =>
    mutation.mutate(() =>
      term === "available"
        ? removeScheduleCourse(view.schedule.id, courseId)
        : assignScheduleCourse(view.schedule.id, courseId, { term }),
    );
  return (
    <>
      <ApiErrorMessage error={mutation.error} />
      <div className="space-y-4 lg:hidden">
        <section className="rounded-xl border bg-card shadow">
          <h2 className="p-6 text-lg font-semibold">Your Selected Courses</h2>
          <div className="space-y-4 px-6 pb-6">
            {allCourses.map((course) => {
              const currentTerm =
                assigned.find((item) => item.course.id === course.id)?.term ??
                "available";
              const options = [
                { value: "available", label: "Unscheduled" },
                ...terms.map((value) => ({ value, label: value })),
              ];
              if (!options.some((option) => option.value === currentTerm))
                options.push({ value: currentTerm, label: currentTerm });
              return (
                <div
                  key={course.id}
                  className="flex items-center justify-between gap-2 rounded-xl border p-4 shadow-sm"
                >
                  <div>
                    <p className="font-medium">
                      {course.code}
                      <CourseInfoDialog course={course} />
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {course.name}
                    </p>
                  </div>
                  <SelectField
                    label={`Term for ${course.code}`}
                    value={currentTerm}
                    options={options}
                    disabled={mutation.isPending}
                    onChange={(term) => changeTerm(course.id, term)}
                  />
                </div>
              );
            })}
          </div>
        </section>
        {terms.map((term) => {
          const courses = sort(
            assigned
              .filter((item) => item.term === term)
              .map((item) => item.course),
          );
          if (!courses.length) return null;
          return (
            <section
              key={term}
              aria-label={term}
              className="rounded-xl border bg-card shadow"
            >
              <h2 className="p-6 text-lg font-semibold">{term}</h2>
              <div className="space-y-2 px-6 pb-6">
                {courses.map((course) => (
                  <div key={course.id}>
                    <p className="font-medium">
                      {course.code}
                      <CourseInfoDialog course={course} />
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {course.name}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div className="hidden lg:block">
        <DndContext
          id={`schedule-${view.schedule.id}`}
          onDragEnd={({ active, over }) => {
            if (!over || mutation.isPending) return;
            const courseId = String(active.id);
            const term = String(over.id);
            changeTerm(courseId, term);
          }}
        >
          <div className="grid grid-cols-[1fr_3fr] gap-6">
            <TermBoard
              name="Available Courses"
              id="available"
              courses={available}
              disabled={mutation.isPending}
            />
            <div className="grid h-min grid-cols-3 gap-4 p-2">
              {terms.map((term) => (
                <TermBoard
                  key={term}
                  name={term}
                  courses={sort(
                    assigned
                      .filter((item) => item.term === term)
                      .map((item) => item.course),
                  )}
                  disabled={mutation.isPending}
                />
              ))}
            </div>
          </div>
        </DndContext>
      </div>
    </>
  );
}
