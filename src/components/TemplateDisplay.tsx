"use client";

import { TemplateRequirements } from "@/components/TemplateRequirements";

type Props = {
  userTemplates: {
    template: {
      id: number;
      name: string;
      items: Array<{
        id: number;
        type: "requirement" | "instruction" | "separator";
        description: string;
        orderIndex: number;
        templateId: number;
        courses: Array<{
          course: {
            id: number;
            code: string;
            name: string;
            rating: number | null;
            difficulty: number | null;
            workload: number | null;
          };
        }>;
      }>;
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
  console.log("userTemplates:", userTemplates); // For debugging

  const allItems = userTemplates
    .flatMap(({ template }) =>
      template.items.map((item) => ({
        ...item,
        templateId: template.id,
        templateName: template.name,
      })),
    )
    .sort((a, b) => {
      if (a.templateName !== b.templateName) {
        return a.templateName.localeCompare(b.templateName);
      }
      return a.orderIndex - b.orderIndex;
    });

  console.log("allItems:", allItems); // For debugging

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
