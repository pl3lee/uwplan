"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useState } from "react";
import { createTemplateAction } from "@/server/actions";
import { toast } from "sonner";
import { normalizeCourseCode } from "@/lib/utils";

type CourseOption = {
  id: string;
  code: string;
};

type TemplateFormProps = {
  courseOptions: CourseOption[];
};

type ItemType = "instruction" | "requirement" | "separator";

type FormItem = {
  type: ItemType;
  description?: string;
  courseType?: "fixed" | "free";
  courses?: string;
  count?: number;
};

function RequiredLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label>
      {children}
      <span className="ml-1 text-red-500">*</span>
    </Label>
  );
}

export function TemplateForm({ courseOptions }: TemplateFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<FormItem[]>([]);

  const handleSubmit = async () => {
    // Validate template name
    if (!name.trim()) {
      toast.error("Template name is required");
      return;
    }

    // Validate items
    for (const item of items) {
      if (item.type !== "separator" && !item.description?.trim()) {
        toast.error("Description is required for all items except separators");
        return;
      }

      if (item.type === "requirement") {
        if (!item.courseType) {
          toast.error("Course type must be selected for requirements");
          return;
        }

        if (item.courseType === "fixed") {
          if (!item.courses?.trim()) {
            toast.error("Course list is required for fixed requirements");
            return;
          }

          const courseList = item.courses
            .split(",")
            .map((c) => normalizeCourseCode(c.trim()));
          const invalidCourses = courseList.filter(
            (code) => !courseOptions.find((option) => option.code === code),
          );

          if (invalidCourses.length > 0) {
            toast.error(`Invalid course codes: ${invalidCourses.join(", ")}`);
            return;
          }
        }

        if (item.courseType === "free") {
          if (!item.count || item.count < 1) {
            toast.error(
              "Course count must be at least 1 for free requirements",
            );
            return;
          }
        }
      }
    }

    try {
      await createTemplateAction({
        name,
        description,
        items: items.map((item, index) => ({
          type: item.type,
          description: item.type === "separator" ? undefined : item.description,
          orderIndex: index,
          ...(item.type === "requirement" && {
            courseType: item.courseType,
            courses:
              item.courseType === "fixed"
                ? item.courses
                    ?.split(",")
                    .map((c) => normalizeCourseCode(c.trim()))
                : undefined,
            courseCount: item.courseType === "free" ? item.count : undefined,
          }),
        })),
      });
      toast.success("Template created successfully");
      // Optional: Reset form
      setName("");
      setDescription("");
      setItems([]);
    } catch (error) {
      toast.error("Failed to create template");
      console.error(error);
    }
  };

  const updateItem = (index: number, updates: Partial<FormItem>) => {
    setItems(
      items.map((item, i) => (i === index ? { ...item, ...updates } : item)),
    );
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const addFixedRequirement = () => {
    setItems([
      ...items,
      {
        type: "requirement",
        courseType: "fixed",
        courses: "",
        description: "",
      },
    ]);
  };

  const addFreeRequirement = () => {
    setItems([
      ...items,
      {
        type: "requirement",
        courseType: "free",
        courses: "",
        description: "",
        count: 1,
      },
    ]);
  };

  const addSeparator = () => {
    setItems([...items, { type: "separator" }]);
  };

  const addInstruction = () => {
    setItems([...items, { type: "instruction", description: "" }]);
  };

  return (
    <form action={handleSubmit}>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Template Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <RequiredLabel>Template Name</RequiredLabel>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 space-y-4">
        <div className="flex gap-2">
          <Button type="button" onClick={addInstruction}>
            Add Instruction
          </Button>
          <Button type="button" onClick={addFixedRequirement}>
            Add Fixed Requirement
          </Button>
          <Button type="button" onClick={addFreeRequirement}>
            Add Free Requirement
          </Button>
          <Button type="button" onClick={addSeparator}>
            Add Separator
          </Button>
        </div>

        {items.map((item, index) => (
          <Card key={index}>
            <CardHeader>
              <CardTitle>
                {item.type === "instruction"
                  ? "Instruction"
                  : item.type === "requirement"
                    ? "Requirement"
                    : "Separator"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {item.type !== "separator" && (
                <div>
                  <RequiredLabel>Description</RequiredLabel>
                  <Input
                    value={item.description}
                    onChange={(e) =>
                      updateItem(index, { description: e.target.value })
                    }
                    required
                  />
                </div>
              )}

              {item.type === "requirement" && (
                <>
                  <div>
                    <RequiredLabel>Requirement Type</RequiredLabel>
                    <Select
                      value={item.courseType}
                      onValueChange={(value: "fixed" | "free") =>
                        updateItem(index, { courseType: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fixed Courses</SelectItem>
                        <SelectItem value="free">Free Choice</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {item.courseType === "fixed" && (
                    <div>
                      <RequiredLabel>Select Courses</RequiredLabel>
                      <Input
                        value={item.courses}
                        onChange={(e) =>
                          updateItem(index, { courses: e.target.value })
                        }
                        required
                      />
                    </div>
                  )}

                  {item.courseType === "free" && (
                    <div>
                      <RequiredLabel>How many courses?</RequiredLabel>
                      <Input
                        value={item.count}
                        type="number"
                        onChange={(e) =>
                          updateItem(index, { count: parseInt(e.target.value) })
                        }
                        required
                      />
                    </div>
                  )}
                </>
              )}

              <Button
                type="button"
                variant="destructive"
                onClick={() => removeItem(index)}
              >
                Remove
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Button className="mt-6" type="submit">
        Create Template
      </Button>
    </form>
  );
}
