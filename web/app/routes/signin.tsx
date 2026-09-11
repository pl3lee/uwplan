import {
  Link,
  type LoaderFunctionArgs,
  redirect,
  useLoaderData,
} from "react-router";
import { Button } from "~/components/button";
import { PatternBackground } from "~/components/pattern-background";
import { SignInOptions } from "~/components/sign-in-options";
import { currentUser } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  if (await currentUser(request)) return redirect("/select");
  const error = new URL(request.url).searchParams.get("error");
  return {
    error:
      error === "OAuthAccountNotLinked"
        ? "This email is already associated with another sign-in method. Use the method you originally signed up with."
        : error
          ? "Sign-in could not be completed. Please try again."
          : null,
  };
}

export default function SignIn() {
  const { error } = useLoaderData<typeof loader>();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Button
        variant="ghost"
        className="absolute left-4 top-4 z-10 md:text-background/80"
        asChild
      >
        <Link to="/">
          <svg
            aria-hidden="true"
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
        <SignInOptions error={error} />
      </div>
    </div>
  );
}
