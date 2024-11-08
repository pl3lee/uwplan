"use client";

import { TemplateRequirements } from "@/components/TemplateRequirements";

type Props = {
  userTemplates: {
    template: {
      id: number;
      name: string;
      items: any[];
    };
  }[];
  userId: string;
  initialSelections: Map<number, boolean>;
};

export function TemplateDisplay({
  userTemplates,
  userId,
  initialSelections,
}: Props) {
  const allItems = userTemplates
    .flatMap(({ template }) =>
      template.items.map((item) => ({
        ...item,
        templateId: template.id, // Add template ID
        templateName: template.name,
      })),
    )
    .sort((a, b) => {
      if (a.templateName !== b.templateName) {
        return a.templateName.localeCompare(b.templateName);
      }
      return a.orderIndex - b.orderIndex;
    });

  return (
    <div className="space-y-12">
      {userTemplates.length > 0 ? (
        <TemplateRequirements
          items={allItems}
          userId={userId}
          initialSelections={initialSelections}
        />
      ) : (
        <p className="text-muted-foreground">
          No academic plans selected. Please select plans from the dropdown
          above.
        </p>
      )}
    </div>
  );
}
