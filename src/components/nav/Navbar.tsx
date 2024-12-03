import { auth, signOut } from "@/server/auth";
import {
  getRole,
  getTemplates,
  getUserPlan,
  getUserSelectedTemplates,
} from "@/server/db/queries";
import Link from "next/link";
import { TabSelector } from "./TabSelector";
import { TemplateSelector } from "./TemplateSelector";
import { Button } from "@/components/ui/button";
import { BottomNav } from "./BottomNav";

export default async function Navbar() {
  const session = await auth();
  const templates = await getTemplates();
  const selectedTemplates = session?.user
    ? await getUserSelectedTemplates(session.user.id)
    : [];
  const userPlan = session?.user ? await getUserPlan(session.user.id) : null;
  const userRole = session?.user ? await getRole(session.user.id) : null;
  return (
    <>
      <nav className="p-4">
        <div className="container mx-auto flex items-center justify-end gap-4">
          {userRole && userRole === "admin" && (
            <Button variant="link" asChild>
              <Link href="/admin">Admin</Link>
            </Button>
          )}
          <div className="hidden md:block">
            {session?.user && <TabSelector />}
          </div>

          {session?.user && userPlan && (
            <TemplateSelector
              templates={templates}
              selectedTemplates={selectedTemplates}
            />
          )}

          {!session?.user ? (
            <Button variant="default" asChild>
              <Link href="/signin">Sign in</Link>
            </Button>
          ) : (
            <form
              action={async () => {
                "use server";
                await signOut({
                  redirectTo: "/",
                });
              }}
            >
              <Button type="submit" variant="default">
                Sign Out
              </Button>
            </form>
          )}
        </div>
      </nav>
      {session?.user && <BottomNav />}
    </>
  );
}
