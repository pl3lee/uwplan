import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { deleteTemplate, renameTemplate } from "~/generated/api/client";
import type { TemplateBody } from "~/generated/api/model";
import { ApiError } from "~/lib/api-fetch";
import { useTemplateMutation } from "~/lib/template-management";
import { ApiErrorMessage } from "./api-error";
import { Button } from "./button";

const popupClass =
  "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg border bg-background p-6 shadow-lg";

function TemplateError({ error }: { error: unknown }) {
  return error instanceof ApiError && error.status === 409 ? (
    <p role="alert" className="text-sm text-destructive">
      Academic plan name already exists
    </p>
  ) : (
    <ApiErrorMessage error={error} />
  );
}

function RenameTemplate({ template }: { template: TemplateBody }) {
  const [open, setOpen] = useState(false);
  const [unchanged, setUnchanged] = useState(false);
  const mutation = useTemplateMutation();
  const form = useForm({
    defaultValues: {
      name: template.name,
      description: template.description ?? "",
    },
    onSubmit: async ({ value }) => {
      if (
        value.name === template.name &&
        value.description === (template.description ?? "")
      ) {
        setUnchanged(true);
        return;
      }
      setUnchanged(false);
      try {
        await mutation.mutateAsync(() =>
          renameTemplate(template.id, { ...value, name: value.name.trim() }),
        );
        setOpen(false);
      } catch {
        /* The dialog renders the mutation error. */
      }
    },
  });
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          form.reset({
            name: template.name,
            description: template.description ?? "",
          });
          mutation.reset();
          setUnchanged(false);
        }
        setOpen(next);
      }}
    >
      <Dialog.Trigger render={<Button variant="outline" />}>
        Rename
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup className={popupClass}>
          <Dialog.Title className="text-lg font-semibold">
            Rename Academic Plan
          </Dialog.Title>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <fieldset disabled={mutation.isPending} className="space-y-4">
              <form.Field name="name">
                {(field) => (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Name</span>
                    <input
                      className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                      required
                      maxLength={255}
                      placeholder="Enter plan name"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </label>
                )}
              </form.Field>
              <form.Field name="description">
                {(field) => (
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Description</span>
                    <textarea
                      className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                      placeholder="Enter plan description"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) =>
                        field.handleChange(event.target.value)
                      }
                    />
                  </label>
                )}
              </form.Field>
              {unchanged && (
                <p role="alert" className="text-sm text-destructive">
                  No changes to save
                </p>
              )}
              <TemplateError error={mutation.error} />
              <Button type="submit" className="w-full">
                {mutation.isPending ? "Renaming…" : "Save Changes"}
              </Button>
            </fieldset>
            <Dialog.Close
              render={<Button variant="ghost" />}
              disabled={mutation.isPending}
            >
              Cancel
            </Dialog.Close>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteTemplate({ template }: { template: TemplateBody }) {
  const [open, setOpen] = useState(false);
  const mutation = useTemplateMutation();
  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger render={<Button variant="destructive" />}>
        Delete
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Popup className={popupClass}>
          <AlertDialog.Title className="text-lg font-semibold">
            Delete Academic Plan
          </AlertDialog.Title>
          <AlertDialog.Description>
            Are you sure you want to delete this academic plan? This action
            cannot be undone.
          </AlertDialog.Description>
          <ApiErrorMessage error={mutation.error} />
          <div className="flex justify-end gap-2">
            <AlertDialog.Close
              render={<Button variant="outline" />}
              disabled={mutation.isPending}
            >
              Cancel
            </AlertDialog.Close>
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(() => deleteTemplate(template.id))}
            >
              {mutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function TemplateCards({ templates }: { templates: TemplateBody[] }) {
  return (
    <div className="flex flex-col gap-2">
      {templates.map((template) => (
        <section
          key={template.id}
          aria-label={template.name}
          className="flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 shadow md:flex-row"
        >
          <div className="min-w-0 md:w-3/4">
            <p className="font-medium">{template.name}</p>
            <p className="text-sm text-muted-foreground">
              {template.description}
            </p>
            <p className="break-all text-sm text-muted-foreground">
              ID: {template.id}
            </p>
          </div>
          <div className="flex gap-2 md:items-center md:justify-end">
            <RenameTemplate template={template} />
            <DeleteTemplate template={template} />
          </div>
        </section>
      ))}
    </div>
  );
}
