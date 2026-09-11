import { useForm } from "@tanstack/react-form";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router";
import { createTemplate } from "~/generated/api/client";
import type {
  CourseBody,
  TemplateDraftBody,
  TemplateDraftItemBody,
} from "~/generated/api/model";
import { useTemplateMutation } from "~/lib/template-management";
import { Button } from "./button";
import { TemplateError } from "./template-error";

type ItemKind = "instruction" | "fixed" | "free" | "separator";
type EditorItem = {
  id: string;
  kind: ItemKind;
  description: string;
  codes: string;
  count: number;
};
export type TemplateEditorValues = {
  name: string;
  description: string;
  items: EditorItem[];
};
const kinds: { kind: ItemKind; label: string }[] = [
  { kind: "instruction", label: "Instruction" },
  { kind: "fixed", label: "Fixed Requirement" },
  { kind: "free", label: "Free Requirement" },
  { kind: "separator", label: "Separator" },
];
const codesFor = (item: EditorItem) =>
  item.codes.split(",").map((code) => code.replace(/\s+/g, "").toUpperCase());
const itemTitle = (item: EditorItem, index: number) =>
  `Item ${index + 1}: ${kinds.find(({ kind }) => kind === item.kind)?.label}`;
const inputClass =
  "h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring";
function draftItem(item: EditorItem): TemplateDraftItemBody {
  if (item.kind === "separator") return { type: "separator" };
  if (item.kind === "instruction")
    return { type: "instruction", description: item.description };
  return {
    type: "requirement",
    description: item.description,
    course_type: item.kind,
    ...(item.kind === "free"
      ? { course_count: item.count }
      : { course_codes: codesFor(item) }),
  };
}

export function TemplateEditor({
  courses,
  copyControl,
  initial = { name: "", description: "", items: [] },
}: {
  courses: CourseBody[];
  copyControl?: ReactNode;
  initial?: TemplateEditorValues;
}) {
  const navigate = useNavigate();
  const mutation = useTemplateMutation();
  const [errors, setErrors] = useState<string[]>([]);
  const form = useForm({
    defaultValues: initial,
    onSubmit: async ({ value }) => {
      const messages = value.items.length
        ? []
        : ["At least one item is required"];
      const catalog = new Set(courses.map((course) => course.code));
      for (const [index, item] of value.items.entries()) {
        if (item.kind !== "fixed") continue;
        const invalid = codesFor(item).filter((code) => !catalog.has(code));
        if (invalid.length)
          messages.push(
            `Invalid codes in "${itemTitle(item, index)}": ${invalid.join(", ")}`,
          );
      }
      setErrors(messages);
      if (messages.length) return;
      const draft: TemplateDraftBody = {
        name: value.name.trim(),
        description: value.description,
        items: value.items.map(draftItem),
      };
      try {
        await mutation.mutateAsync(() => createTemplate(draft));
        await navigate("/select");
      } catch {
        /* Safe validation and API errors are shown with the form. */
      }
    },
  });
  return (
    <form
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLInputElement &&
          event.currentTarget.contains(event.target)
        )
          event.preventDefault();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <fieldset disabled={mutation.isPending}>
        <section className="mt-6 rounded-xl border bg-card shadow">
          <h2 className="p-6 text-lg font-semibold">Academic Plan Details</h2>
          <div className="space-y-4 px-6 pb-6">
            {copyControl && (
              <div className="mb-4 flex flex-col gap-2">
                <span className="text-sm font-medium">
                  Start from template (optional)
                </span>
                {copyControl}
              </div>
            )}
            <form.Field name="name">
              {(field) => (
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Name</span>
                  <input
                    className={inputClass}
                    required
                    maxLength={255}
                    placeholder="Template Name"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </label>
              )}
            </form.Field>
            <form.Field name="description">
              {(field) => (
                <label className="block space-y-2">
                  <span className="text-sm font-medium">Description</span>
                  <input
                    className={inputClass}
                    placeholder="Template Description"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </label>
              )}
            </form.Field>
          </div>
        </section>
        <form.Field name="items" mode="array">
          {(items) => (
            <div className="relative mt-6 space-y-4">
              <div className="sticky top-0 z-10 flex flex-wrap justify-center gap-2 bg-background p-2">
                {kinds.map(({ kind, label }) => (
                  <Button
                    key={kind}
                    variant="secondary"
                    type="button"
                    onClick={() =>
                      items.pushValue({
                        id: crypto.randomUUID(),
                        kind,
                        description: "",
                        codes: "",
                        count: 1,
                      })
                    }
                  >
                    Add {label}
                  </Button>
                ))}
                <Button type="submit">
                  {mutation.isPending ? "Creating…" : "Create Academic Plan"}
                </Button>
              </div>
              {errors.map((error) => (
                <p
                  key={error}
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {error}
                </p>
              ))}
              <TemplateError error={mutation.error} />
              {items.state.value.map((item, index) => (
                <section
                  key={item.id}
                  aria-label={itemTitle(item, index)}
                  className="rounded-xl border bg-card shadow"
                >
                  <div className="flex items-center justify-between p-6 pb-2">
                    <h2 className="text-lg font-semibold">
                      {itemTitle(item, index)}
                    </h2>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Move item ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => items.swapValues(index, index - 1)}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Move item ${index + 1} down`}
                        disabled={index === items.state.value.length - 1}
                        onClick={() => items.swapValues(index, index + 1)}
                      >
                        ↓
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 px-6 pb-6">
                    {item.kind !== "separator" && (
                      <form.Field name={`items[${index}].description`}>
                        {(field) => (
                          <label className="block space-y-2">
                            <span
                              className={
                                item.kind === "instruction"
                                  ? "sr-only"
                                  : "text-sm font-medium"
                              }
                            >
                              {item.kind === "instruction"
                                ? "Instruction"
                                : "Description"}
                            </span>
                            <input
                              className={inputClass}
                              required
                              placeholder="e.g. Complete all of the following"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                            />
                          </label>
                        )}
                      </form.Field>
                    )}
                    {item.kind === "fixed" && (
                      <form.Field name={`items[${index}].codes`}>
                        {(field) => (
                          <label className="block space-y-2">
                            <span className="text-sm font-medium">
                              Select Courses
                            </span>
                            <input
                              className={inputClass}
                              required
                              placeholder="CS135, CS136"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(event.target.value)
                              }
                            />
                          </label>
                        )}
                      </form.Field>
                    )}
                    {item.kind === "free" && (
                      <form.Field name={`items[${index}].count`}>
                        {(field) => (
                          <label className="block space-y-2">
                            <span className="text-sm font-medium">
                              How many courses?
                            </span>
                            <input
                              className={inputClass}
                              required
                              type="number"
                              min={1}
                              step={1}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) =>
                                field.handleChange(Number(event.target.value))
                              }
                            />
                          </label>
                        )}
                      </form.Field>
                    )}
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => items.removeValue(index)}
                    >
                      Remove
                    </Button>
                  </div>
                </section>
              ))}
            </div>
          )}
        </form.Field>
      </fieldset>
    </form>
  );
}
