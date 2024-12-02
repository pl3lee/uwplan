"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toggleCourseAction, updateFreeCourseAction } from "@/server/actions";
import { type FixedCourse, type FreeCourse, type Course } from "@/types/course";
import { useState } from "react";
import Link from "next/link";
import { Button } from "./ui/button";
import { normalizeCourseCode } from "@/lib/utils";
import { ArrowUpDown, ArrowUp, ArrowDown, Check, X } from "lucide-react";

type SortDirection = "asc" | "desc" | null;
type SortColumn =
  | "code"
  | "name"
  | "useful"
  | "liked"
  | "easy"
  | "numRatings"
  | null;

type FixedCourseWithItem = {
  courseItemId: string;
  course: Course;
};

type CourseTableProps = {
  fixedCourses?: FixedCourseWithItem[];
  freeCourses?: FreeCourse[];
  allCourses: Course[];
  selectedCourseItems: Set<string>;
  otherSelectedCourses: string[];
};

export function CourseTable({
  fixedCourses = [],
  freeCourses = [],
  allCourses,
  selectedCourseItems,
  otherSelectedCourses,
}: CourseTableProps) {
  const initFreeCourseMap = new Map();
  freeCourses.forEach((freeCourse) => {
    initFreeCourseMap.set(
      freeCourse.courseItemId,
      freeCourse.course?.code ?? "",
    );
  });
  const [freeCourseInputs, setFreeCourseInputs] =
    useState<Map<string, string>>(initFreeCourseMap);
  const [sortColumn, setSortColumn] = useState<SortColumn>("code");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const formatRating = (rating: string | null | undefined) => {
    if (!rating) return "N/A";
    return `${(Number(rating) * 100).toFixed(1)}%`;
  };

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((curr) =>
        curr === "asc" ? "desc" : curr === "desc" ? null : "asc",
      );
      if (sortDirection === "desc") {
        setSortColumn(null);
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const getSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) return <ArrowUpDown className="h-4 w-4" />;
    if (sortDirection === "asc") return <ArrowUp className="h-4 w-4" />;
    if (sortDirection === "desc") return <ArrowDown className="h-4 w-4" />;
    return <ArrowUpDown className="h-4 w-4" />;
  };

  const sortCourses = (courses: FixedCourseWithItem[]) => {
    if (!sortColumn || !sortDirection) return courses;

    return [...courses].sort((a, b) => {
      const courseA = a.course;
      const courseB = b.course;

      const multiplier = sortDirection === "asc" ? 1 : -1;

      switch (sortColumn) {
        case "code":
          return (
            (courseA.code ?? "").localeCompare(courseB.code ?? "") * multiplier
          );
        case "name":
          return (
            (courseA.name ?? "").localeCompare(courseB.name ?? "") * multiplier
          );
        case "useful":
          return (
            (Number(courseA.usefulRating ?? 0) -
              Number(courseB.usefulRating ?? 0)) *
            multiplier
          );
        case "liked":
          return (
            (Number(courseA.likedRating ?? 0) -
              Number(courseB.likedRating ?? 0)) *
            multiplier
          );
        case "easy":
          return (
            (Number(courseA.easyRating ?? 0) -
              Number(courseB.easyRating ?? 0)) *
            multiplier
          );
        case "numRatings":
          return (
            ((courseA.numRatings ?? 0) - (courseB.numRatings ?? 0)) * multiplier
          );
        default:
          return 0;
      }
    });
  };

  const sortedFixedCourses = sortCourses(fixedCourses);
  // Remove sorting for free courses
  const sortedFreeCourses = freeCourses;

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/12">Take?</TableHead>
            <TableHead className="w-1/12">Taken</TableHead>
            <TableHead className="w-2/12">
              <Button
                variant="ghost"
                onClick={() => handleSort("code")}
                className="flex h-8 items-center gap-1"
              >
                Code {fixedCourses.length > 0 && getSortIcon("code")}
              </Button>
            </TableHead>
            <TableHead className="w-4/12">
              <Button
                variant="ghost"
                onClick={() => handleSort("name")}
                className="flex h-8 items-center gap-1"
              >
                Name {fixedCourses.length > 0 && getSortIcon("name")}
              </Button>
            </TableHead>
            <TableHead className="w-1/12 text-right">
              <Button
                variant="ghost"
                onClick={() => handleSort("useful")}
                className="ml-auto flex h-8 items-center gap-1"
              >
                Useful {fixedCourses.length > 0 && getSortIcon("useful")}
              </Button>
            </TableHead>
            <TableHead className="w-1/12 text-right">
              <Button
                variant="ghost"
                onClick={() => handleSort("liked")}
                className="ml-auto flex h-8 items-center gap-1"
              >
                Liked {fixedCourses.length > 0 && getSortIcon("liked")}
              </Button>
            </TableHead>
            <TableHead className="w-1/12 text-right">
              <Button
                variant="ghost"
                onClick={() => handleSort("easy")}
                className="ml-auto flex h-8 items-center gap-1"
              >
                Easy {fixedCourses.length > 0 && getSortIcon("easy")}
              </Button>
            </TableHead>
            <TableHead className="w-1/12 text-right">
              <Button
                variant="ghost"
                onClick={() => handleSort("numRatings")}
                className="ml-auto flex h-8 items-center gap-1"
              >
                # Ratings {fixedCourses.length > 0 && getSortIcon("numRatings")}
              </Button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedFixedCourses.map(({ courseItemId, course }) => (
            <TableRow key={courseItemId}>
              <TableCell>
                <Checkbox
                  checked={selectedCourseItems.has(courseItemId)}
                  onCheckedChange={(checked) =>
                    toggleCourseAction(courseItemId, checked as boolean)
                  }
                />
              </TableCell>
              <TableCell>
                {otherSelectedCourses.includes(course.id) ? <Check /> : <X />}
              </TableCell>
              <TableCell>
                <Button asChild variant="link">
                  <Link
                    href={`https://uwflow.com/course/${course.code}`}
                    target="_blank"
                  >
                    {course.code}
                  </Link>
                </Button>
              </TableCell>
              <TableCell>{course.name}</TableCell>
              <TableCell className="text-right">
                {formatRating(course.usefulRating)}
              </TableCell>
              <TableCell className="text-right">
                {formatRating(course.likedRating)}
              </TableCell>
              <TableCell className="text-right">
                {formatRating(course.easyRating)}
              </TableCell>
              <TableCell className="text-right">
                {course.numRatings ? Number(course.numRatings) : 0}
              </TableCell>
            </TableRow>
          ))}
          {sortedFreeCourses.map((freeCourse) => (
            <TableRow key={freeCourse.courseItemId}>
              <TableCell>
                <Checkbox
                  checked={selectedCourseItems.has(freeCourse.courseItemId)}
                  onCheckedChange={(checked) =>
                    freeCourse.course &&
                    toggleCourseAction(
                      freeCourse.courseItemId,
                      checked as boolean,
                    )
                  }
                  disabled={!freeCourse.course}
                />
              </TableCell>
              <TableCell>
                {freeCourse.course?.id &&
                otherSelectedCourses.includes(freeCourse.course.id) ? (
                  <Check />
                ) : (
                  <X />
                )}
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <Input
                    value={freeCourseInputs.get(freeCourse.courseItemId)}
                    onChange={async (event) => {
                      const normalizedCourseCode = normalizeCourseCode(
                        event.target.value,
                      );
                      setFreeCourseInputs((prev) => {
                        const newMap = new Map(prev);
                        newMap.set(
                          freeCourse.courseItemId,
                          normalizedCourseCode,
                        );
                        return newMap;
                      });
                      const filledCourseId = allCourses.find(
                        (c) => c.code === normalizedCourseCode,
                      )?.id;
                      if (!filledCourseId) {
                        return;
                      }
                      await updateFreeCourseAction(
                        freeCourse.courseItemId,
                        filledCourseId,
                      );
                    }}
                    placeholder="Course code"
                    className="w-full"
                  />
                  {freeCourse.course && (
                    <div className="text-xs text-muted-foreground">
                      Current:
                      <Button asChild variant="link">
                        <Link
                          href={`https://uwflow.com/course/${freeCourse.course.code}`}
                          target="_blank"
                          className="text-xs"
                        >
                          <span className="text-muted-foreground">
                            {freeCourse.course.code}
                          </span>
                        </Link>
                      </Button>
                    </div>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {freeCourse.course?.name ?? "No course selected"}
              </TableCell>
              <TableCell className="text-right">
                {formatRating(freeCourse.course?.usefulRating)}
              </TableCell>
              <TableCell className="text-right">
                {formatRating(freeCourse.course?.likedRating)}
              </TableCell>
              <TableCell className="text-right">
                {formatRating(freeCourse.course?.easyRating)}
              </TableCell>
              <TableCell className="text-right">
                {freeCourse.course?.numRatings
                  ? Number(freeCourse.course.numRatings)
                  : 0}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
