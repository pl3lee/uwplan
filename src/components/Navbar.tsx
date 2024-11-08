import { auth, signIn, signOut } from "@/server/auth";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function Navbar() {
  const session = await auth();
  // TODO: fetch academic plans to populate the select options
  return (
    <nav className="p-4">
      <div className="container mx-auto flex items-center justify-end gap-4">
        <Tabs defaultValue="select" className="">
          <TabsList>
            <TabsTrigger value="select">Select</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
          </TabsList>
        </Tabs>

        <Select>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Select Academic Plans" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="placeholder1">placeholder1</SelectItem>
            <SelectItem value="placeholder2">placeholder2</SelectItem>
            <SelectItem value="placeholder3">placeholder3</SelectItem>
          </SelectContent>
        </Select>

        {!session?.user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="default">Sign in</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem asChild>
                <form
                  action={async () => {
                    "use server";
                    await signIn("google");
                  }}
                >
                  <button type="submit">with Google</button>
                </form>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <form
                  action={async () => {
                    "use server";
                    await signIn("github");
                  }}
                >
                  <button type="submit">with GitHub</button>
                </form>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <Button type="submit" variant="default">
              Sign Out
            </Button>
          </form>
        )}
      </div>
    </nav>
  );
}
