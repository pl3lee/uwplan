import { auth } from "@/server/auth";
import { redirect } from "next/navigation";
import styles from "@/styles/utils.module.css";
import { getRole, getTemplates, getUsers } from "@/server/db/queries";
import { DeleteTemplateButton } from "@/app/(app)/(management)/DeleteTemplateButton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function ManageTemplatePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin");
  }
  const templates = await getTemplates();

  return (
    <div className="container mx-auto py-10">
      <h1 className={styles.pageTitleText}>Admin page</h1>

      <div className="mt-8">
        <h2 className="mb-4 text-2xl font-bold">Templates</h2>
        <div className="rounded-md border">
          <div className="divide-y">
            {templates.map((template) => (
              <div
                key={template.id}
                className="flex items-center justify-between p-4"
              >
                <div className="space-y-1">
                  <h2 className="text-lg font-medium leading-none">
                    {template.name}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {template.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ID: {template.id}
                  </p>
                </div>
                <DeleteTemplateButton templateId={template.id} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
