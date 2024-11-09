import { Button } from "@/components/ui/button";
import { auth } from "@/server/auth";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getTemplates } from "@/server/db/queries";

type Template = {
  id: number;
  name: string;
};

export async function TemplateSelector() {
  const session = await auth();
  // if (!session?.user) return null;
  const templates = await getTemplates();
  console.log(templates);
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
            // checked={selectedIds.has(template.id)}
            // onCheckedChange={(checked) =>
            //   handleCheckedChange(template, checked)
            // }
          >
            {template.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
