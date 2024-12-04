import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { auth } from "@/server/auth";
import { getRole, getTemplates, getUsers } from "@/server/db/queries";
import styles from "@/styles/utils.module.css";
import { type Template } from "@/types/template";
import { redirect } from "next/navigation";
import { TemplateCard } from "../TemplateCard";

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
        <div className="flex flex-col gap-2">
          {templates.map((template: Template) => (
            <TemplateCard template={template} key={template.id} />
          ))}
        </div>
      </div>
    </div>
  );
}
