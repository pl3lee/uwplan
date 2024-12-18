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
import {
  getTemplateFormItemTitle,
  transformTemplateFormData,
  validateCreateTemplateFormCourseCodes,
} from "@/lib/utils";
import { createTemplateAction } from "@/server/actions";
import { type BasicTemplates } from "@/server/db/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { TemplateSelector } from "./TemplateSelector";

export const formSchema = z.object({
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

export type CourseOption = {
  id: string;
  code: string;
};

type TemplateFormProps = {
  courseOptions: CourseOption[];
  templates: BasicTemplates;
  clonedTemplateForm: z.infer<typeof formSchema> | null;
};

export type FormItem = z.infer<typeof formSchema>["items"][number];

export function TemplateForm({
  courseOptions,
  templates,
  clonedTemplateForm,
}: TemplateFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: "",
      items: [],
    },
  });

  useEffect(() => {
    if (clonedTemplateForm) {
      form.reset(clonedTemplateForm);
    }
  }, [clonedTemplateForm, form]);

  // Add handler for template selection
  const handleTemplateSelect = (templateId: string) => {
    const current = new URLSearchParams(Array.from(searchParams.entries()));
    current.set("templateId", templateId);
    const search = current.toString();
    const query = search ? `?${search}` : "";
    router.push(`${pathname}${query}`);
  };

  const { fields, append, remove, swap } = useFieldArray({
    control: form.control,
    name: "items",
  });
  const addInstruction = () => {
    append({
      type: "instruction",
      description: "",
    });
  };

  const addFixedRequirement = () => {
    append({
      type: "requirement",
      courseType: "fixed",
      description: "",
      courses: "",
    });
  };

  const addFreeRequirement = () => {
    append({
      type: "requirement",
      courseType: "free",
      description: "",
      count: 1,
    });
  };

  const addSeparator = () => {
    append({
      type: "separator",
    });
  };

  const removeItem = (index: number) => {
    remove(index);
  };

  function moveItem(index: number, direction: "up" | "down") {
    if (
      (direction === "up" && index > 0) ||
      (direction === "down" && index < fields.length - 1)
    ) {
      const newIndex = direction === "up" ? index - 1 : index + 1;
      swap(index, newIndex);
    }
  }

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (values.items.length === 0) {
      toast.error("At least one item is required");
      return;
    }
    try {
      // Validate course codes for fixed requirements
      const errors = validateCreateTemplateFormCourseCodes(
        values.items,
        courseOptions,
      );
      if (errors.length > 0) {
        errors.forEach((error) => toast.error(error));
        return;
      }

      // Transform data for createTemplateAction
      const error = await createTemplateAction(
        transformTemplateFormData(values),
      );
      if (error) {
        toast.error(error.error.message);
        return;
      }
      toast.success("Academic plan created successfully");
      form.reset();
      router.push("/select");
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error("An unknown error occurred");
      }
    }
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
            <div className="mb-4 flex flex-col gap-2">
              <FormLabel>Start from template (optional)</FormLabel>
              <TemplateSelector
                templates={templates}
                onSelect={handleTemplateSelect}
              />
            </div>
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

          {fields.map((field, index) => (
            <AnimatePresence mode="popLayout" initial={false} key={field.id}>
              <motion.div
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{
                  duration: 0.2,
                  ease: "easeInOut",
                  layout: {
                    duration: 0.2,
                    ease: "easeInOut",
                  },
                }}
              >
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle>
                      {getTemplateFormItemTitle(field, index)}
                    </CardTitle>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => moveItem(index, "up")}
                        disabled={index === 0}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => moveItem(index, "down")}
                        disabled={index === fields.length - 1}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {field.type === "instruction" && (
                      <FormField
                        control={form.control}
                        name={`items.${index}.description` as const}
                        render={({ field: inputField }) => (
                          <FormItem className="flex flex-col gap-2">
                            <FormControl>
                              <Input
                                {...inputField}
                                placeholder="e.g. Complete all of the following"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    {field.type === "requirement" && (
                      <>
                        <FormField
                          control={form.control}
                          name={`items.${index}.description` as const}
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
                            field.courseType === "fixed"
                              ? (`items.${index}.courses` as const)
                              : (`items.${index}.count` as const)
                          }
                          render={({ field: formField }) => (
                            <FormItem>
                              <FormLabel>
                                {field.courseType === "fixed"
                                  ? "Select Courses"
                                  : "How many courses?"}
                              </FormLabel>
                              <FormControl>
                                {field.courseType === "fixed" ? (
                                  <Input
                                    type="text"
                                    {...formField}
                                    placeholder="CS135, CS136"
                                  />
                                ) : (
                                  <Input
                                    type="number"
                                    min={1}
                                    {...formField}
                                    onChange={(e) => {
                                      formField.onChange(
                                        parseInt(e.target.value, 10),
                                      );
                                    }}
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
              </motion.div>
            </AnimatePresence>
          ))}
        </div>
      </form>
    </Form>
  );
}
