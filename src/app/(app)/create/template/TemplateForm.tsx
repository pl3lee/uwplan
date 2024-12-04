"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { normalizeCourseCode } from "@/lib/utils";
import { createTemplateAction } from "@/server/actions";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

const formSchema = z.object({
  name: z.string().min(1, { message: "Name is required" }),
  description: z.string().optional(),
  items: z.array(
    z.union([
      z.object({
        type: z.literal("instruction"),
        description: z.string().min(1, { message: "Instruction is required" }),
      }),
      z.object({
        type: z.literal("separator"),
      }),
      z.object({
        type: z.literal("requirement"),
        courseType: z.literal("fixed"),
        description: z.string().min(1, { message: "Description is required" }),
        courses: z.string().min(1),
      }),
      z.object({
        type: z.literal("requirement"),
        courseType: z.enum(["free"]),
        description: z.string().min(1, { message: "Description is required" }),
        count: z.number().min(1, { message: "Must have at least 1 course" }),
      }),
    ]),
  ),
});

type CourseOption = {
  id: string;
  code: string;
};

type TemplateFormProps = {
  courseOptions: CourseOption[];
};

type FormItem = z.infer<typeof formSchema>["items"][number];

export function TemplateForm({ courseOptions }: TemplateFormProps) {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      items: [],
    },
  });

  const items = form.watch("items");

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (values.items.length === 0) {
      toast.error("At least one item is required");
      return;
    }
    try {
      // Validate course codes for fixed requirements
      for (const item of values.items) {
        if (item.type === "requirement" && item.courseType === "fixed") {
          const courseCodes = item.courses
            .split(",")
            .map((code) => normalizeCourseCode(code.trim()));

          const invalidCodes = courseCodes.filter(
            (code) => !courseOptions.find((opt) => opt.code === code),
          );

          if (invalidCodes.length > 0) {
            toast.error(
              `Invalid course codes in requirement "${item.description}": ${invalidCodes.join(
                ", ",
              )}`,
            );
            return;
          }
        }
      }

      // Transform data for createTemplateAction
      const templateSuccessfullyCreated = await createTemplateAction({
        name: values.name,
        description: values.description,
        items: values.items.map((item, index) => {
          if (item.type === "instruction") {
            return {
              type: "instruction",
              description: item.description,
              orderIndex: index,
            };
          } else if (item.type === "separator") {
            return {
              type: "separator",
              orderIndex: index,
            };
          } else if (
            item.type === "requirement" &&
            item.courseType === "fixed"
          ) {
            return {
              type: "requirement",
              courseType: "fixed",
              description: item.description,
              courses: item.courses
                .split(",")
                .map((c) => normalizeCourseCode(c.trim())),
              orderIndex: index,
            };
          } else if (
            item.type === "requirement" &&
            item.courseType === "free"
          ) {
            return {
              type: "requirement",
              courseType: "free",
              description: item.description,
              courses: [],
              courseCount: item.count,
              orderIndex: index,
            };
          }
          return item;
        }),
      });
      console.log("templateExists", templateSuccessfullyCreated);
      if (templateSuccessfullyCreated) {
        toast.success("Template created successfully");
        form.reset();
      } else {
        toast.error("Template with this name already exists");
        return;
      }
    } catch (error) {
      toast.error("Failed to create template");
      console.error(error);
    }
  };

  const addInstruction = () => {
    const currentItems = form.getValues("items");
    form.setValue("items", [
      ...currentItems,
      {
        type: "instruction",
        description: "",
      },
    ]);
  };

  const addFixedRequirement = () => {
    const currentItems = form.getValues("items");
    form.setValue("items", [
      ...currentItems,
      {
        type: "requirement",
        courseType: "fixed",
        description: "",
        courses: "",
      },
    ]);
  };

  const addFreeRequirement = () => {
    const currentItems = form.getValues("items");
    form.setValue("items", [
      ...currentItems,
      {
        type: "requirement",
        courseType: "free",
        description: "",
        count: 1,
      },
    ]);
  };

  const addSeparator = () => {
    const currentItems = form.getValues("items");
    form.setValue("items", [
      ...currentItems,
      {
        type: "separator",
      },
    ]);
  };

  const removeItem = (index: number) => {
    const currentItems = form.getValues("items");
    form.setValue(
      "items",
      currentItems.filter((_, i) => i !== index),
    );
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
          }
        }}
      >
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Academic Plan Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Template Name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Template Description" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        <div className="relative mt-6 space-y-4">
          <div className="sticky top-0 flex flex-wrap justify-center gap-2 bg-white bg-opacity-100 p-2">
            <Button type="button" onClick={addInstruction} variant="secondary">
              Add Instruction
            </Button>
            <Button
              type="button"
              onClick={addFixedRequirement}
              variant="secondary"
            >
              Add Fixed Requirement
            </Button>
            <Button
              type="button"
              onClick={addFreeRequirement}
              variant="secondary"
            >
              Add Free Requirement
            </Button>
            <Button type="button" onClick={addSeparator} variant="secondary">
              Add Separator
            </Button>
            <Button type="submit">Create Academic Plan</Button>
          </div>

          {items.map((item, index) => (
            <Card key={index}>
              <CardHeader>
                <CardTitle>
                  {String(item.type[0]).toUpperCase() +
                    String(item.type).slice(1)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {item.type === "instruction" && (
                  <FormField
                    control={form.control}
                    name={`items.${index}.description`}
                    render={({ field }) => (
                      <FormItem className="flex flex-col gap-2">
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="e.g. Complete all of the following"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {item.type === "requirement" && (
                  <>
                    <FormField
                      control={form.control}
                      name={`items.${index}.description`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="e.g. Complete all of the following"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={
                        item.courseType === "fixed"
                          ? `items.${index}.courses`
                          : `items.${index}.count`
                      }
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {item.courseType === "fixed"
                              ? "Select Courses"
                              : "How many courses?"}
                          </FormLabel>
                          <FormControl>
                            {item.courseType === "fixed" ? (
                              <Input
                                type="text"
                                {...field}
                                placeholder="CS135, CS136"
                              />
                            ) : (
                              <Input
                                type="number"
                                min={1}
                                {...field}
                                onChange={(e) =>
                                  field.onChange(parseInt(e.target.value, 10))
                                }
                              />
                            )}
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
                <Button
                  type="button"
                  onClick={() => removeItem(index)}
                  variant="destructive"
                >
                  Remove
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </form>
    </Form>
  );
}
