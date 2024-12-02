import { Button } from "@/components/ui/button";
import Link from "next/link";
import { PatternBackground } from "./PatternBackground";
import { SignInOptions } from "./SignInOptions";

export default function SignIn() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Button
        variant="ghost"
        className="absolute left-4 top-4 z-10 md:text-background/80"
        asChild
      >
        <Link href="/">
          <svg
            className="mr-2 h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Back to Home
        </Link>
      </Button>

      <div className="relative hidden overflow-hidden bg-primary md:flex md:w-1/2">
        <PatternBackground />
      </div>
      <div className="flex flex-1 items-center justify-center bg-background p-6 md:p-10">
        <SignInOptions />
      </div>
    </div>
  );
}
