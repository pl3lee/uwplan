import { Combobox } from "@base-ui/react/combobox";
import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { TemplateBody } from "~/generated/api/model";
import { Button, buttonVariants } from "./button";

export function TemplatePicker({
  templates,
  selectedId,
}: {
  templates: TemplateBody[];
  selectedId: string;
}) {
  const [open, setOpen] = useState(false);
  const [candidate, setCandidate] = useState<TemplateBody | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const selected = templates.find((template) => template.id === selectedId);
  return (
    <>
      <Combobox.Root<TemplateBody>
        items={templates}
        value={null}
        open={open}
        onOpenChange={setOpen}
        itemToStringLabel={(item) => item.name}
        onValueChange={(item) => {
          if (item) {
            setCandidate(item);
            setOpen(false);
          }
        }}
      >
        <Combobox.Trigger
          role="combobox"
          aria-label="Copy academic plan"
          className={`${buttonVariants({ variant: "outline" })} w-full justify-between overflow-hidden`}
        >
          <span className="truncate">
            {selected?.name ?? "Select an academic plan to copy..."}
          </span>
          <span aria-hidden="true">⌄</span>
        </Combobox.Trigger>
        <Combobox.Portal>
          <Combobox.Positioner className="z-50" sideOffset={4}>
            <Combobox.Popup className="w-(--anchor-width) rounded-md border bg-popover shadow-md">
              <Combobox.Input
                aria-label="Search plans to copy"
                placeholder="Search framework..."
                className="h-9 w-full border-b px-3 text-sm outline-none"
              />
              <Combobox.Empty className="p-3 text-sm">
                No plan found.
              </Combobox.Empty>
              <Combobox.List className="max-h-60 overflow-y-auto p-1">
                {(item: TemplateBody) => (
                  <Combobox.Item
                    key={item.id}
                    value={item}
                    className="cursor-default rounded-sm p-2 text-sm outline-none data-highlighted:bg-accent"
                  >
                    {item.name}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      <Dialog.Root
        open={candidate !== null}
        onOpenChange={(next) => {
          if (!next && !loading) setCandidate(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-lg border bg-background p-6 shadow-lg">
            <Dialog.Title className="text-lg font-semibold">
              Load Academic Plan
            </Dialog.Title>
            <Dialog.Description>
              Are you sure you want to load the academic plan &quot;
              {candidate?.name}&quot;? This will reset your current form.
            </Dialog.Description>
            <div className="flex justify-end gap-3">
              <Dialog.Close
                render={<Button variant="outline" />}
                disabled={loading}
              >
                Cancel
              </Dialog.Close>
              <Button
                disabled={loading}
                onClick={async () => {
                  if (!candidate) return;
                  setLoading(true);
                  try {
                    await navigate(
                      `/create/template?templateId=${candidate.id}`,
                    );
                    setCandidate(null);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                {loading ? "Loading…" : "Continue"}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
