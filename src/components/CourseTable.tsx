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
// import { useState } from "react";
// import { toggleCourse, updateFreeCourse } from "@/server/actions";
import { auth } from "@/server/auth";
import { getSelectedCourses, toggleCourseSelection } from "@/server/db/queries";
import { toggleCourse, updateFreeCourse } from "@/server/actions";

type Course = {
  id: string;
  code: string | null;
  name: string | null;
  usefulRating: string | null;
  likedRating: string | null;
  easyRating: string | null;
  numRatings: number | null;
};

type FixedCourse = {
  course: Course;
};

type FreeCourse = {
  courseItemId: string;
  course: Course | null;
};

type Props = {
  fixedCourses?: FixedCourse[];
  freeCourses?: FreeCourse[];
  requirementId: string;
  allCourses: Course[];
  userId: string;
  selectedCourses: Set<string>;
};

export function CourseTable({
  fixedCourses = [],
  freeCourses = [],
  requirementId,
  allCourses,
  userId,
  selectedCourses,
}: Props) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[50px]"></TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className="text-right">Useful</TableHead>
            <TableHead className="text-right">Liked</TableHead>
            <TableHead className="text-right">Easy</TableHead>
            <TableHead className="text-right"># Ratings</TableHead>
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
              <TableCell>{course.code}</TableCell>
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
                    onChange={async (event) => {
                      const filledCourseId = allCourses.find(
                        (c) => c.code === event.target.value,
                      )?.id;
                      if (!filledCourseId) {
                        return;
                      }
                      await updateFreeCourse(
                        freeCourse.courseItemId,
                        filledCourseId,
                      );
                    }}
                    placeholder="Enter course code"
                    className="w-24"
                  />
                  {freeCourse.course && (
                    <div className="text-xs text-muted-foreground">
                      Current: {freeCourse.course.code}
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
