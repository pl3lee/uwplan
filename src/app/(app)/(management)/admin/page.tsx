import { auth } from "@/server/auth";
import { redirect } from "next/navigation";
import styles from "@/styles/utils.module.css";
import { getRole, getTemplates, getUsers } from "@/server/db/queries";
import { DeleteTemplateButton } from "../DeleteTemplateButton";
import { RenameTemplateButton } from "@/components/RenameTemplateButton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin");
  }
  const role = await getRole(session.user.id);
  if (role !== "admin") {
    redirect("/select");
  }
  const templates = await getTemplates();
  const users = await getUsers();

  return (
    <div className="container mx-auto py-10">
      <h1 className={styles.pageTitleText}>Admin page</h1>

      <div className="mt-8">
        <h2 className="mb-4 text-2xl font-bold">Users</h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.name ?? "N/A"}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>{user.role}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

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
                <div className="flex items-center">
                  <RenameTemplateButton
                    templateId={template.id}
                    initialName={template.name}
                    initialDescription={template.description ?? ""}
                  />
                  <DeleteTemplateButton templateId={template.id} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
