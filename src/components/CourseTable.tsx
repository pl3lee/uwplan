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
import { useState } from "react";
import { updateFreeCourse } from "@/server/actions";

type Course = {
  id: number;
  code: string;
  name: string;
  usefulRating: string | null;
  likedRating: string | null;
  easyRating: string | null;
  numRatings: number | null;
};

type FixedCourse = {
  course: Course;
};

type FreeCourse = {
  courseItemId: number;
  course: Course | null;
};

type Props = {
  fixedCourses?: FixedCourse[];
  freeCourses?: FreeCourse[];
  requirementId: number;
  allCourses: Course[];
  userId: string;
};

export function CourseTable({
  fixedCourses = [],
  freeCourses = [],
  requirementId,
  allCourses,
  userId,
}: Props) {
  const [selectedCourses, setSelectedCourses] = useState<Set<number>>(
    new Set(),
  );
  // Initialize courseInputs with existing course codes
  const [courseInputs, setCourseInputs] = useState<Record<number, string>>(
    () => {
      const inputs: Record<number, string> = {};
      freeCourses.forEach((fc) => {
        if (fc.course) {
          inputs[fc.courseItemId] = fc.course.code;
        }
      });
      return inputs;
    },
  );

  const toggleCourse = (courseId: number) => {
    const newSelected = new Set(selectedCourses);
    if (newSelected.has(courseId)) {
      newSelected.delete(courseId);
    } else {
      newSelected.add(courseId);
    }
    setSelectedCourses(newSelected);
  };

  const handleCourseInput = (courseItemId: number, value: string) => {
    setCourseInputs((prev) => ({
      ...prev,
      [courseItemId]: value.toUpperCase(),
    }));
  };

  const handleCourseUpdate = async (courseItemId: number) => {
    const courseCode = courseInputs[courseItemId];
    const course = allCourses.find((c) => c.code === courseCode);
    await updateFreeCourse(courseItemId, course?.id ?? null);
  };

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
                  onCheckedChange={() => toggleCourse(course.id)}
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
                  onCheckedChange={() =>
                    freeCourse.course && toggleCourse(freeCourse.course.id)
                  }
                  disabled={!freeCourse.course}
                />
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <Input
                    value={courseInputs[freeCourse.courseItemId] || ""}
                    onChange={(e) =>
                      handleCourseInput(freeCourse.courseItemId, e.target.value)
                    }
                    onBlur={() => handleCourseUpdate(freeCourse.courseItemId)}
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
