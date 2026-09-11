import { Checkbox } from "@base-ui/react/checkbox";
import { PreviewCard } from "@base-ui/react/preview-card";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  changeFreeCourse,
  removeSelectedCourse,
  setCourseSelection,
} from "~/generated/api/client";
import type {
  CourseBody,
  PlanStateBody,
  TemplateCourseItemBody,
} from "~/generated/api/model";
import { usePlanningMutation } from "~/lib/planning-mutation";
import { ApiErrorMessage } from "./api-error";
import { Button, buttonVariants } from "./button";
import { CourseDetails } from "./course-details";

export function CourseLink({ course }: { course: CourseBody }) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        href={`https://uwflow.com/course/${course.code}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`${buttonVariants({ variant: "link" })} text-blue-600`}
      >
        {course.code}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner sideOffset={4} className="z-50">
          <PreviewCard.Popup className="w-80 rounded-md border bg-popover p-4 text-popover-foreground shadow-md">
            <CourseDetails course={course} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

type CourseRow = {
  id: string;
  course: CourseBody | undefined;
  action: ReactNode;
  code: ReactNode;
  taken?: boolean;
};
const rating = (value: string | null | undefined) =>
  value ? `${(Number(value) * 100).toFixed(1)}%` : "N/A";

function CourseTable({
  rows,
  actionLabel,
}: {
  rows: CourseRow[];
  actionLabel: "Remove" | "Take?";
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "code", desc: false },
  ]);
  const columns = useMemo<ColumnDef<CourseRow>[]>(
    () => [
      {
        id: "action",
        header: actionLabel,
        cell: (info) => info.row.original.action,
        enableSorting: false,
      },
      ...(actionLabel === "Take?"
        ? [
            {
              id: "taken",
              header: "Taken",
              cell: (info: { row: { original: CourseRow } }) => (
                <span
                  role="img"
                  aria-label={
                    info.row.original.taken
                      ? "Selected elsewhere"
                      : "Not selected"
                  }
                >
                  {info.row.original.taken ? "✓" : "×"}
                </span>
              ),
              enableSorting: false,
            },
          ]
        : []),
      {
        id: "code",
        header: "Code",
        accessorFn: (row) => row.course?.code ?? "",
        cell: (info) => info.row.original.code,
      },
      {
        id: "name",
        header: "Name",
        accessorFn: (row) => row.course?.name ?? "",
        cell: (info) => info.row.original.course?.name ?? "No course selected",
      },
      {
        id: "useful",
        header: "Useful",
        accessorFn: (row) => Number(row.course?.useful_rating ?? 0),
        cell: (info) => rating(info.row.original.course?.useful_rating),
      },
      {
        id: "liked",
        header: "Liked",
        accessorFn: (row) => Number(row.course?.liked_rating ?? 0),
        cell: (info) => rating(info.row.original.course?.liked_rating),
      },
      {
        id: "easy",
        header: "Easy",
        accessorFn: (row) => Number(row.course?.easy_rating ?? 0),
        cell: (info) => rating(info.row.original.course?.easy_rating),
      },
      {
        id: "ratings",
        header: "# Ratings",
        accessorFn: (row) => row.course?.num_ratings ?? 0,
        cell: (info) =>
          info.row.original.course?.num_ratings ??
          (actionLabel === "Remove" ? "N/A" : 0),
      },
    ],
    [actionLabel],
  );
  const defaultRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          Number(a.course?.code.match(/\d+/)?.[0] ?? 0) -
          Number(b.course?.code.match(/\d+/)?.[0] ?? 0),
      ),
    [rows],
  );
  const table = useReactTable({
    data: defaultRows,
    sortDescFirst: false,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full caption-bottom text-sm">
        <thead className="border-b">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th
                  key={header.id}
                  className="h-10 px-2 text-left align-middle font-medium text-muted-foreground"
                  aria-sort={
                    header.column.getIsSorted() === "asc"
                      ? "ascending"
                      : header.column.getIsSorted() === "desc"
                        ? "descending"
                        : undefined
                  }
                >
                  {header.column.getCanSort() ? (
                    <Button
                      variant="ghost"
                      className="h-8 gap-1"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <span aria-hidden="true">
                        {header.column.getIsSorted() === "asc"
                          ? "↑"
                          : header.column.getIsSorted() === "desc"
                            ? "↓"
                            : "↕"}
                      </span>
                    </Button>
                  ) : (
                    flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-b transition-colors last:border-0 hover:bg-muted/50"
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={`p-2 align-middle ${["useful", "liked", "easy", "ratings"].includes(cell.column.id) ? "px-6 text-right" : ""}`}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RemoveCourse({ course }: { course: CourseBody }) {
  const mutation = usePlanningMutation();
  return (
    <>
      <Button
        variant="destructive"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate(() => removeSelectedCourse(course.id))}
      >
        Remove
      </Button>
      <ApiErrorMessage error={mutation.error} />
    </>
  );
}

export function SelectedCoursesTable({ courses }: { courses: CourseBody[] }) {
  const rows = courses.map((course) => ({
    id: course.id,
    course,
    action: <RemoveCourse course={course} />,
    code: <CourseLink course={course} />,
  }));
  return <CourseTable rows={rows} actionLabel="Remove" />;
}

function CourseChoice({
  slot,
  course,
  selected,
}: {
  slot: TemplateCourseItemBody;
  course: CourseBody | undefined;
  selected: boolean;
}) {
  const mutation = usePlanningMutation();
  const [pendingSelection, setPendingSelection] = useState<boolean>();
  return (
    <>
      <Checkbox.Root
        aria-label={`Take ${course?.code ?? "course"}`}
        checked={pendingSelection ?? selected}
        disabled={!course || mutation.isPending}
        onCheckedChange={(checked) => {
          setPendingSelection(checked);
          mutation.mutate(
            () => setCourseSelection(slot.id, { selected: checked }),
            {
              onSettled: () => setPendingSelection(undefined),
            },
          );
        }}
        className="flex size-4 items-center justify-center rounded-sm border border-primary shadow outline-none focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary data-checked:text-primary-foreground data-disabled:opacity-50"
      >
        <Checkbox.Indicator>✓</Checkbox.Indicator>
      </Checkbox.Root>
      <ApiErrorMessage error={mutation.error} />
    </>
  );
}

type CourseCatalog = {
  byID: ReadonlyMap<string, CourseBody>;
  byCode: ReadonlyMap<string, CourseBody>;
};

function FreeCourseCode({
  slot,
  course,
  byCode,
}: {
  slot: TemplateCourseItemBody;
  course: CourseBody | undefined;
  byCode: CourseCatalog["byCode"];
}) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [value, setValue] = useState(course?.code ?? "");
  const input = useRef<HTMLInputElement>(null);
  // A valid code may be a prefix of another code. Keep typing uninterrupted,
  // and serialize this slot's writes so an earlier save cannot win a race.
  const mutation = usePlanningMutation(`free-course:${slot.id}`);
  useEffect(() => {
    if (document.activeElement !== input.current) setValue(course?.code ?? "");
  }, [course?.code]);
  return (
    <div className="space-y-1">
      <input
        ref={input}
        aria-label="Course code"
        placeholder="Course code"
        className="h-9 w-28 rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        value={value}
        disabled={!hydrated}
        onChange={(event) => {
          const code = event.target.value.replace(/\s+/g, "").toUpperCase();
          setValue(code);
          const match = byCode.get(code);
          if (match)
            mutation.mutate(() =>
              changeFreeCourse(slot.id, { course_id: match.id }),
            );
        }}
      />
      {course && (
        <div className="text-sm text-muted-foreground">
          Current: <CourseLink course={course} />
        </div>
      )}
      <ApiErrorMessage error={mutation.error} />
    </div>
  );
}

export function RequirementCourses({
  slots,
  catalog,
  plan,
}: {
  slots: TemplateCourseItemBody[];
  catalog: CourseCatalog;
  plan: PlanStateBody;
}) {
  const choices = new Map(
    (plan.choices ?? []).map((choice) => [choice.item_id, choice]),
  );
  const selected = new Set(plan.selected_course_ids ?? []);
  const rows = slots.map((slot) => {
    const choice = choices.get(slot.id);
    const id = slot.type === "free" ? choice?.course_id : slot.course_id;
    const course = id ? catalog.byID.get(id) : undefined;
    return {
      id: slot.id,
      course,
      taken: !!course && selected.has(course.id),
      action: (
        <CourseChoice
          slot={slot}
          course={course}
          selected={choice?.selected ?? false}
        />
      ),
      code:
        slot.type === "free" ? (
          <FreeCourseCode
            key={slot.id}
            slot={slot}
            course={course}
            byCode={catalog.byCode}
          />
        ) : course ? (
          <CourseLink course={course} />
        ) : null,
    };
  });
  return <CourseTable rows={rows} actionLabel="Take?" />;
}
