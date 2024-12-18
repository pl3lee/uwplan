"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function TabSelector() {
  const pathname = usePathname();
  const tabValue =
    pathname === "/select" || pathname === "/schedule"
      ? pathname.substring(1)
      : "";

  return (
    <Tabs value={tabValue} defaultValue={pathname.substring(1)} className="">
      <TabsList>
        <TabsTrigger value="select" asChild>
          <Link href="/select">Select</Link>
        </TabsTrigger>
        <TabsTrigger value="schedule" asChild>
          <Link href="/schedule">Schedule</Link>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
