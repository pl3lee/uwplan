import { Card, CardHeader } from "@/components/ui/card";
import { type Template } from "@/types/template";
import { DeleteTemplateButton } from "./DeleteTemplateButton";
import { RenameTemplateButton } from "./RenameTemplateButton";

export function TemplateCard({ template }: { template: Template }) {
  return (
    <Card key={template.id}>
      <CardHeader className="w-full flex-col justify-between p-4 md:flex-row">
        <div className="flex w-3/4 items-center justify-between">
          <div className="flex items-center gap-2">
            <div>
              <p className="font-medium">{template.name}</p>
              <p className="text-sm text-muted-foreground">
                {template.description}
              </p>
              <p className="text-sm text-muted-foreground">ID: {template.id}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-row md:w-1/4 md:items-center md:justify-end">
          <RenameTemplateButton
            templateId={template.id}
            initialName={template.name}
            initialDescription={template.description ?? ""}
          />
          <DeleteTemplateButton templateId={template.id} />
        </div>
      </CardHeader>
    </Card>
  );
}
