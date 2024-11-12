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
import { auth } from "@/server/auth";
import { getSelectedCourses, toggleCourseSelection } from "@/server/db/queries";
import { toggleCourse, updateFreeCourse } from "@/server/actions";
import { FixedCourse, FreeCourse, Course } from "@/types/course";
import { useState } from "react";
import Link from "next/link";
import { Button } from "./ui/button";
import { normalizeCourseCode } from "@/lib/utils";

type CourseTableProps = {
  fixedCourses?: FixedCourse[];
  freeCourses?: FreeCourse[];
  allCourses: Course[];
  selectedCourses: Set<string>;
};

export function CourseTable({
  fixedCourses = [],
  freeCourses = [],
  allCourses,
  selectedCourses,
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

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/12">Take?</TableHead>
            <TableHead className="w-2/12">Code</TableHead>
            <TableHead className="w-5/12">Name</TableHead>
            <TableHead className="w-1/12 text-right">Useful</TableHead>
            <TableHead className="w-1/12 text-right">Liked</TableHead>
            <TableHead className="w-1/12 text-right">Easy</TableHead>
            <TableHead className="w-1/12 text-right"># Ratings</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {fixedCourses.map(({ course }) => (
            <TableRow key={course.id}>
              <TableCell>
                <Checkbox
                  checked={selectedCourses.has(course.id)}
                  onCheckedChange={(checked) =>
                    toggleCourse(course.id, checked as boolean)
                  }
                />
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
                {course.usefulRating ?? "N/A"}
              </TableCell>
              <TableCell className="text-right">
                {course.likedRating ?? "N/A"}
              </TableCell>
              <TableCell className="text-right">
                {course.easyRating ?? "N/A"}
              </TableCell>
              <TableCell className="text-right">
                {course.numRatings ?? "N/A"}
              </TableCell>
            </TableRow>
          ))}
          {freeCourses.map((freeCourse) => (
            <TableRow key={freeCourse.courseItemId}>
              <TableCell>
                <Checkbox
                  checked={
                    freeCourse.course
                      ? selectedCourses.has(freeCourse.course.id)
                      : false
                  }
                  onCheckedChange={(checked) =>
                    freeCourse.course &&
                    toggleCourse(freeCourse.course.id, checked as boolean)
                  }
                  disabled={!freeCourse.course}
                />
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
                      await updateFreeCourse(
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
                {freeCourse.course?.usefulRating ?? "N/A"}
              </TableCell>
              <TableCell className="text-right">
                {freeCourse.course?.likedRating ?? "N/A"}
              </TableCell>
              <TableCell className="text-right">
                {freeCourse.course?.easyRating ?? "N/A"}
              </TableCell>
              <TableCell className="text-right">
                {freeCourse.course?.numRatings ?? "N/A"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
