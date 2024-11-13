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

type CourseOption = {
  value: string;
  label: string;
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
  courses: string[];
  count?: number;
};

export function TemplateForm({ courseOptions }: TemplateFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<FormItem[]>([]);

  const addItem = (type: ItemType) => {
    setItems([
      ...items,
      { type, courses: [], description: type === "separator" ? undefined : "" },
    ]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, updates: Partial<FormItem>) => {
    setItems(
      items.map((item, i) => (i === index ? { ...item, ...updates } : item)),
    );
  };

  // const handleSubmit = async (e: React.FormEvent) => {
  //   e.preventDefault();
  //   try {
  //     await createTemplateAction({
  //       name,
  //       description: description || undefined,
  //       items: items.map((item, index) => ({
  //         ...item,
  //         orderIndex: index,
  //         description: item.type !== "separator" ? item.description : undefined,
  //       })),
  //     });
  //   } catch (error) {
  //     console.error(error);
  //   }
  // };
  const handleSubmit = async () => {
    await createTemplateAction();
  };

  return (
    <form>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Template Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="name">Template Name</Label>
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
          <Button type="button" onClick={() => addItem("instruction")}>
            Add Instruction
          </Button>
          <Button type="button" onClick={() => addItem("requirement")}>
            Add Requirement
          </Button>
          <Button type="button" onClick={() => addItem("separator")}>
            Add Separator
          </Button>
        </div>

        {items.map((item, index) => (
          <Card key={index}>
            <CardContent className="space-y-4 pt-6">
              {item.type !== "separator" && (
                <div>
                  <Label>Description</Label>
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
                    <Label>Requirement Type</Label>
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
                      <Label>Select Courses</Label>
                      <Select
                        value={item.courses[0]}
                        onValueChange={(value) =>
                          updateItem(index, { courses: [value] })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select course" />
                        </SelectTrigger>
                        <SelectContent>
                          {courseOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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

      <Button className="mt-6" onClick={handleSubmit}>
        Create Template
      </Button>
    </form>
  );
}
