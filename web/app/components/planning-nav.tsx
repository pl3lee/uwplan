import { Combobox } from "@base-ui/react/combobox";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, NavLink } from "react-router";
import { logout, setTemplateMembership } from "~/generated/api/client";
import type {
  PlanStateBody,
  TemplateBody,
  UserBody,
} from "~/generated/api/model";
import { usePlanningMutation } from "~/lib/planning-mutation";
import { cn } from "~/lib/utils";
import { ApiErrorMessage } from "./api-error";
import { Button, buttonVariants } from "./button";

function AcademicPlans({
  templates,
  plan,
}: {
  templates: TemplateBody[];
  plan: PlanStateBody;
}) {
  const [open, setOpen] = useState(false);
  const mutation = usePlanningMutation();
  const selected = templates.filter((template) =>
    plan.template_ids?.includes(template.id),
  );
  return (
    <div>
      <Combobox.Root
        multiple
        items={templates}
        value={selected}
        open={open}
        onOpenChange={setOpen}
        itemToStringLabel={(item) => item.name}
        isItemEqualToValue={(a, b) => a.id === b.id}
        onValueChange={(value) => {
          if (mutation.isPending) return;
          const added = value.find(
            (item) => !selected.some((current) => current.id === item.id),
          );
          const removed = selected.find(
            (item) => !value.some((current) => current.id === item.id),
          );
          const changed = added ?? removed;
          if (changed)
            mutation.mutate(() =>
              setTemplateMembership(changed.id, { selected: !!added }),
            );
        }}
      >
        <Combobox.Trigger
          role="combobox"
          aria-label="Academic plans"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "w-60 justify-between",
          )}
        >
          {selected.length
            ? `${selected.length} selected`
            : "Select Academic Plans..."}
          <span aria-hidden="true">⌄</span>
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner sideOffset={4} className="z-50">
            <Combobox.Popup
              className="w-[250px] rounded-md border bg-popover text-popover-foreground shadow-md"
              onKeyDownCapture={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                }
              }}
            >
              <Combobox.Input
                aria-label="Search academic plans"
                placeholder="Search academic plan..."
                className="h-9 w-full border-b px-3 text-sm outline-none"
              />
              <Combobox.Empty className="p-3 text-sm">
                No academic plans found.
              </Combobox.Empty>
              <Combobox.List className="max-h-[200px] overflow-y-auto p-1">
                {(item: TemplateBody) => (
                  <Combobox.Item
                    key={item.id}
                    value={item}
                    disabled={mutation.isPending}
                    className="flex cursor-default items-center gap-2 rounded-sm p-2 text-sm outline-none data-highlighted:bg-accent"
                  >
                    <span className="w-4" aria-hidden="true">
                      {selected.some((value) => value.id === item.id)
                        ? "✓"
                        : ""}
                    </span>
                    {item.name}
                  </Combobox.Item>
                )}
              </Combobox.List>
              <div className="flex flex-col gap-2 border-t p-2 text-center">
                <Link
                  className={buttonVariants({ variant: "link" })}
                  to="/create/template"
                  onClick={() => setOpen(false)}
                >
                  Add a new academic plan
                </Link>
                <Link
                  className={buttonVariants({ variant: "link" })}
                  to="/manage/template"
                  onClick={() => setOpen(false)}
                >
                  Manage your created plans
                </Link>
              </div>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      <ApiErrorMessage error={mutation.error} />
    </div>
  );
}

export function PlanningNav({
  user,
  plan,
  templates,
}: {
  user: UserBody;
  plan: PlanStateBody;
  templates: TemplateBody[];
}) {
  const client = useQueryClient();
  const signOut = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => {
      client.clear();
      window.location.assign("/");
    },
  });
  return (
    <>
      <nav className="p-4" aria-label="Main navigation">
        <div className="container mx-auto flex items-center justify-end gap-4">
          {user.role === "admin" && (
            <Link to="/admin" className={buttonVariants({ variant: "link" })}>
              Admin
            </Link>
          )}
          <div className="hidden rounded-lg bg-muted p-1 text-muted-foreground md:flex">
            {[
              ["/select", "Select"],
              ["/schedule", "Schedule"],
            ].map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1 text-sm font-medium",
                    isActive && "bg-background text-foreground shadow",
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </div>
          <AcademicPlans templates={templates} plan={plan} />
          <Button disabled={signOut.isPending} onClick={() => signOut.mutate()}>
            Sign Out
          </Button>
        </div>
        <ApiErrorMessage error={signOut.error} />
      </nav>
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-10 border-t bg-white md:hidden"
      >
        <div className="grid h-16 grid-cols-2">
          {[
            ["/select", "Select"],
            ["/schedule", "Schedule"],
          ].map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center justify-center",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                {label === "Schedule" ? (
                  <>
                    <rect x="3" y="5" width="18" height="16" rx="2" />
                    <path d="M16 3v4M8 3v4M3 11h18" />
                  </>
                ) : (
                  <>
                    <path d="m3 6 2 2 3-4M11 6h10M11 12h10M11 18h10" />
                    <path d="M4 12h2M4 18h2" />
                  </>
                )}
              </svg>
              <span className="text-xs">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  );
}
