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
import { useState, useOptimistic, startTransition } from "react";
import { toggleUserTemplateAction } from "@/server/actions";
import { type Template } from "@/types/template";
import { toast } from "sonner";

type Props = {
  templates: Template[];
  selectedTemplates: Template[];
};

export function TemplateSelector({ templates, selectedTemplates }: Props) {
  const [open, setOpen] = useState(false);
  const [optimisticTemplates, updateOptimisticTemplates] = useOptimistic(
    selectedTemplates,
    (state: Template[], templateId: string) => {
      const isSelected = state.some((t) => t.id === templateId);
      if (isSelected) {
        return state.filter((t) => t.id !== templateId);
      } else {
        const template = templates.find((t) => t.id === templateId);
        return template ? [...state, template] : state;
      }
    },
  );
  const handleToggleTemplate = async (templateId: string) => {
    startTransition(() => {
      updateOptimisticTemplates(templateId);
    });
    try {
      await toggleUserTemplateAction(
        templateId,
        !optimisticTemplates.some((t) => t.id === templateId),
      );
    } catch (error) {
      toast.error("Failed to toggle academic plan");
      console.error(error);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-60 justify-between"
        >
          {optimisticTemplates.length > 0
            ? `${optimisticTemplates.length} selected`
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
                    onSelect={async () =>
                      await handleToggleTemplate(template.id)
                    }
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        optimisticTemplates.some(
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
          <div className="flex flex-col gap-2 border-t p-2 text-center">
            <Button asChild variant="link">
              <Link href="/create/template" onClick={() => setOpen(false)}>
                Add a new academic plan
              </Link>
            </Button>
            <Button asChild variant="link">
              <Link href="/manage/template" onClick={() => setOpen(false)}>
                Manage your created plans
              </Link>
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
