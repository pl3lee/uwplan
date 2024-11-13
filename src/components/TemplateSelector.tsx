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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Select Academic Plans</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Templates</DropdownMenuLabel>
        {templates.map((template) => (
          <DropdownMenuCheckboxItem
            key={template.id}
            checked={selectedTemplates.some((item) => item.id === template.id)}
            onCheckedChange={async () => await toggleTemplate(template.id)}
          >
            {template.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
