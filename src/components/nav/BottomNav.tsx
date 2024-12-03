"use client";
import { usePathname } from "next/navigation";
import { ListTodo, Calendar } from "lucide-react";
import Link from "next/link";

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-10 border-t bg-white md:hidden">
      <div className="grid h-16 grid-cols-2">
        <Link
          href="/select"
          className={`flex flex-col items-center justify-center ${pathname === "/select" ? "text-primary" : "text-muted-foreground"}`}
        >
          <ListTodo className="h-5 w-5" />
          <span className="text-xs">Select</span>
        </Link>
        <Link
          href="/schedule"
          className={`flex flex-col items-center justify-center ${pathname === "/schedule" ? "text-primary" : "text-muted-foreground"}`}
        >
          <Calendar className="h-5 w-5" />
          <span className="text-xs">Schedule</span>
        </Link>
      </div>
    </nav>
  );
}
