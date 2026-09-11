import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  createSchedule,
  deleteSchedule,
  renameSchedule,
} from "~/generated/api/client";
import type { ScheduleBody } from "~/generated/api/model";
import { usePlanningMutation } from "~/lib/planning-mutation";
import { ApiErrorMessage } from "./api-error";
import { Button, buttonVariants } from "./button";
import { ExportSchedule } from "./export-schedule";

const popupClass =
  "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg border bg-background p-6 shadow-lg";

function ScheduleNameDialog({ schedule }: { schedule?: ScheduleBody }) {
  const [open, setOpen] = useState(false);
  const mutation = usePlanningMutation();
  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      try {
        await mutation.mutateAsync(() =>
          schedule ? renameSchedule(schedule.id, value) : createSchedule(value),
        );
        form.reset();
        setOpen(false);
      } catch {
        /* The mutation error is rendered inside the dialog. */
      }
    },
  });
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={<Button variant={schedule ? "outline" : "default"} />}
      >
        {schedule ? "Rename Schedule" : "Add Schedule"}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Popup className={popupClass}>
          <Dialog.Title className="text-lg font-semibold">
            {schedule ? "Rename Schedule" : "New Schedule"}
          </Dialog.Title>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="name">
              {(field) => (
                <label className="block space-y-2">
                  <span className="text-sm font-medium">
                    {schedule ? "New Name" : "Schedule Name"}
                  </span>
                  <input
                    required
                    maxLength={20}
                    className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                    placeholder={schedule?.name ?? "Schedule name"}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </label>
              )}
            </form.Field>
            <ApiErrorMessage error={mutation.error} />
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : schedule ? "Rename" : "Create"}
            </Button>
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

function DeleteSchedule({
  schedule,
  schedules,
}: {
  schedule: ScheduleBody;
  schedules: ScheduleBody[];
}) {
  const [open, setOpen] = useState(false);
  const mutation = usePlanningMutation();
  const navigate = useNavigate();
  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger
        render={<Button variant="destructive" />}
        disabled={schedules.length <= 1}
      >
        Delete Schedule
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Popup className={popupClass}>
          <AlertDialog.Title className="text-lg font-semibold">
            Delete Schedule
          </AlertDialog.Title>
          <AlertDialog.Description>
            Are you sure you want to delete this schedule? This action cannot be
            undone.
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
              onClick={() =>
                mutation.mutate(async () => {
                  await deleteSchedule(schedule.id);
                  const next = schedules.find(
                    (item) => item.id !== schedule.id,
                  );
                  // Move away before invalidation removes this dialog's owner.
                  await navigate(
                    next ? `/schedule?scheduleId=${next.id}` : "/schedule",
                  );
                })
              }
            >
              {mutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function ScheduleManagement({
  schedules,
  active,
}: {
  schedules: ScheduleBody[];
  active: ScheduleBody;
}) {
  return (
    <>
      <div className="flex flex-col gap-2 md:flex-row">
        <ScheduleNameDialog />
        <ScheduleNameDialog key={active.id} schedule={active} />
        <ExportSchedule id={active.id} />
        <DeleteSchedule
          key={`delete-${active.id}`}
          schedule={active}
          schedules={schedules}
        />
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Schedules">
        {schedules.map((schedule) => (
          <Link
            key={schedule.id}
            to={`/schedule?scheduleId=${schedule.id}`}
            className={buttonVariants({
              variant: schedule.id === active.id ? "default" : "outline",
            })}
            aria-current={schedule.id === active.id ? "page" : undefined}
          >
            {schedule.name}
          </Link>
        ))}
      </nav>
    </>
  );
}
