"use client";

import Link from "next/link";
import { Check, ChevronsUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState } from "react";
import { toggleTemplate } from "@/server/actions";

type Template = {
  id: string;
  name: string;
  description: string | null;
};

type Props = {
  templates: Template[];
  selectedTemplates: Template[];
};

export function TemplateSelector({ templates, selectedTemplates }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-60 justify-between"
        >
          {selectedTemplates.length > 0
            ? `${selectedTemplates.length} selected`
            : "Select Academic Plans..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0">
        <Command>
          <CommandInput placeholder="Search academic plan..." className="h-9" />
          <CommandList>
            <CommandEmpty>No academic plans found.</CommandEmpty>
            <CommandGroup>
              <ScrollArea className="h-[200px]">
                {templates.map((template) => (
                  <CommandItem
                    key={template.id}
                    value={template.name}
                    onSelect={async () => await toggleTemplate(template.id)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedTemplates.some(
                          (item) => item.id === template.id,
                        )
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    {template.name}
                  </CommandItem>
                ))}
              </ScrollArea>
            </CommandGroup>
          </CommandList>
          <div className="border-t p-2 text-center">
            <Link
              href="/create/template"
              className="text-sm text-blue-500 hover:underline"
              onClick={() => setOpen(false)}
            >
              Add a new academic plan
            </Link>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
