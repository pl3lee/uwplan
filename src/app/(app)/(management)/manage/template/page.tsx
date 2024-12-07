import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { auth } from "@/server/auth";
import { getTemplatesCreatedByUser } from "@/server/db/queries";
import styles from "@/styles/utils.module.css";
import { type Template } from "@/types/template";
import { redirect } from "next/navigation";
import { TemplateCard } from "../../TemplateCard";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "UWPlan - Manage Academic Plans",
};

export default async function ManageTemplatePage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin");
  }
  const templates = await getTemplatesCreatedByUser(session.user.id);

  return (
    <div className="container mx-auto">
      <h1 className={styles.pageTitleText}>Manage Your Created Plans</h1>
      <Alert className="mt-8">
        <AlertTitle>Can&apos;t find your created plan?</AlertTitle>
        <AlertDescription>
          Then you must have have created your academic plan before this
          functionality was implemented, and we do not know what plans you have
          created. Please email billy.pl.lee@gmail.com for assistance.
        </AlertDescription>
      </Alert>
      <div className="mt-8">
        <h2 className="mb-4 text-2xl font-bold">Your Created Plans</h2>
        <div className="flex flex-col gap-2">
          {templates.map((template: Template) => (
            <TemplateCard template={template} key={template.id} />
          ))}
        </div>
      </div>
    </div>
  );
}
