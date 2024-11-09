"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toggleCourse } from "@/server/actions";
import { useState, useEffect } from "react";

type Course = {
  id: number;
  code: string;
  name: string;
  rating: number | null;
  difficulty: number | null;
  workload: number | null;
};

type TemplateItem = {
  id: number;
  type: "requirement" | "instruction" | "separator";
  description: string;
  orderIndex: number;
  templateId: number; // Add this
  templateName: string;
  courses: {
    course: Course;
  }[];
};

type Props = {
  items: TemplateItem[];
  userId: string;
  initialSelections: Map<number, boolean>;
};

export function TemplateRequirements({
  items,
  userId,
  initialSelections,
}: Props) {
  const [selections, setSelections] = useState<Map<number, boolean>>(
    new Map(initialSelections),
  );

  const handleCheckedChange = async (
    templateId: number,
    courseId: number,
    checked: boolean,
  ) => {
    const newSelections = new Map(selections);
    newSelections.set(courseId, checked);
    setSelections(newSelections);
    await toggleCourse(userId, templateId, courseId, checked);
  };

  // Add useEffect to update selections when initialSelections changes
  useEffect(() => {
    setSelections(new Map(initialSelections));
  }, [initialSelections]);

  return (
    <div className="space-y-8">
      {items.map((item) => (
        <div key={`${item.templateName}-${item.id}`} className="space-y-4">
          <h3 className="text-xl font-semibold">
            <span className="text-muted-foreground">{item.templateName}: </span>
            {item.description}
          </h3>
          {item.type === "requirement" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Select</TableHead>
                  <TableHead className="w-[100px]">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-[100px]">Rating</TableHead>
                  <TableHead className="w-[100px]">Difficulty</TableHead>
                  <TableHead className="w-[100px]">Workload</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.courses.map(({ course }) => (
                  <TableRow key={course.id}>
                    <TableCell>
                      <Checkbox
                        checked={selections.get(course.id) ?? false}
                        onCheckedChange={(checked) =>
                          handleCheckedChange(
                            item.templateId,
                            course.id,
                            checked as boolean,
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>{course.code}</TableCell>
                    <TableCell>{course.name}</TableCell>
                    <TableCell>{course.rating ?? "N/A"}</TableCell>
                    <TableCell>{course.difficulty ?? "N/A"}</TableCell>
                    <TableCell>{course.workload ?? "N/A"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {item.type === "instruction" && (
            <p className="text-muted-foreground">{item.description}</p>
          )}
          {item.type === "separator" && <hr />}
        </div>
      ))}
    </div>
  );
}
