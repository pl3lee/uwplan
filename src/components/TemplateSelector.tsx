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
import {
  addTemplateToPlan,
  removeTemplateFromPlan,
  toggleUserTemplate,
} from "@/server/db/queries";

type Template = {
  id: string;
  name: string;
  description: string | null;
};

type Plan = {
  id: string;
  userId: string;
};

type Props = {
  templates: Template[];
  selectedTemplates: Template[];
  userPlan: Plan;
};

export function TemplateSelector({
  templates,
  selectedTemplates,
  userPlan,
}: Props) {
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
            onCheckedChange={async (checked) =>
              await toggleTemplate(template.id)
            }
          >
            {template.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
