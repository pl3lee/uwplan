"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toggleTemplate } from "@/server/actions";
import { useState } from "react";

type Template = {
  id: number;
  name: string;
};

type Props = {
  templates: Template[];
  userId: string;
  initialSelectedIds: Set<number>;
};

export function TemplateSelector({
  templates,
  userId,
  initialSelectedIds,
}: Props) {
  const [selectedIds, setSelectedIds] = useState(initialSelectedIds);

  const handleCheckedChange = async (template: Template, checked: boolean) => {
    await toggleTemplate(userId, template.id, template.name);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(template.id);
      } else {
        next.delete(template.id);
      }
      return next;
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="w-56">
          Select Academic Plans
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Templates</DropdownMenuLabel>
        {templates.map((template) => (
          <DropdownMenuCheckboxItem
            key={template.id}
            checked={selectedIds.has(template.id)}
            onCheckedChange={(checked) =>
              handleCheckedChange(template, checked)
            }
          >
            {template.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
