import { Button } from "@/components/ui/button";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { BasicTemplates } from "@/server/db/queries";
import { ChevronsUpDown, Check } from "lucide-react";
import { useState } from "react";

export function TemplateSelector({
  templates,
  onSelect,
}: {
  templates: BasicTemplates;
  onSelect: (templateId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  return (
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
                  onSelect={(currentName) => {
                    setName(currentName);
                    setOpen(false);
                    onSelect(template.id);
                  }}
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
  );
}
