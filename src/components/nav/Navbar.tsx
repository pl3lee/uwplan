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
  const [session, templates] = await Promise.all([auth(), getTemplates()]);
  const [selectedTemplates, userPlan, userRole] = session?.user
    ? await Promise.all([
        getUserSelectedTemplates(session.user.id),
        getUserPlan(session.user.id),
        getRole(session.user.id),
      ])
    : [[], null, null];
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
