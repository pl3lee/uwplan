"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toggleTemplate } from "@/server/actions";
import Link from "next/link";

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
      <DropdownMenuContent className="max-h-[50dvh] w-56 overflow-y-scroll">
        {templates.map((template) => (
          <DropdownMenuCheckboxItem
            key={template.id}
            checked={selectedTemplates.some((item) => item.id === template.id)}
            onCheckedChange={async () => await toggleTemplate(template.id)}
          >
            {template.name}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuItem>
          <Link href="/create/template">Create an Academic plan</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
