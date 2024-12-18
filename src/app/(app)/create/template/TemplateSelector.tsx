import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { type BasicTemplates } from "@/server/db/queries";
import { Check, ChevronsUpDown } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

type BasicTemplate = {
  id: string;
  name: string;
  description: string | null;
  createdBy: string | null;
};

export function TemplateSelector({
  templates,
  onSelect,
}: {
  templates: BasicTemplates;
  onSelect: (templateId: string) => void;
}) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(
    templates.find((template) => template.id === searchParams.get("templateId"))
      ?.name,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] =
    useState<BasicTemplate | null>(null);

  const handleSelect = (template: BasicTemplate) => {
    setSelectedTemplate(template);
    setDialogOpen(true);
  };

  const handleConfirm = () => {
    if (selectedTemplate) {
      setName(selectedTemplate.name);
      setOpen(false);
      setDialogOpen(false);
      onSelect(selectedTemplate.id);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
          >
            {name
              ? templates.find((template) => template.name === name)?.name
              : "Select an academic plan to copy..."}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
          <Command>
            <CommandInput placeholder="Search framework..." />
            <CommandList>
              <CommandEmpty>No plan found.</CommandEmpty>
              <CommandGroup>
                {templates.map((template) => (
                  <CommandItem
                    key={template.id}
                    value={template.name}
                    onSelect={() => handleSelect(template)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        name === template.name ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {template.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Load Academic Plan</DialogTitle>
            <DialogDescription>
              Are you sure you want to load the academic plan &quot;
              {selectedTemplate?.name}&quot;? This will reset your current form.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>Continue</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
