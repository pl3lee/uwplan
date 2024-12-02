import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center">
      {/* Hero Section */}
      <div className="flex flex-col items-center justify-center space-y-4 px-4 py-24 text-center">
        <h1 className="text-4xl font-bold tracking-tighter sm:text-5xl md:text-6xl">
          Welcome to UWPlan
        </h1>
        <p className="max-w-[600px] text-lg text-muted-foreground sm:text-xl">
          The smarter way to plan your University of Waterloo degree. Build
          schedules, track requirements, and make informed course decisions.
        </p>
        <div className="space-x-4">
          <Button size="lg" asChild>
            <Link href="/signin">Get Started</Link>
          </Button>
          <Button variant="outline" size="lg" asChild>
            <a href="#features">Learn More</a>
          </Button>
        </div>
      </div>

      {/* Features Grid */}
      <div className="grid w-full max-w-5xl grid-cols-1 gap-8 px-4 pb-24 md:grid-cols-3">
        <div className="flex flex-col items-center space-y-2 rounded-lg p-6 text-center transition-all hover:bg-accent hover:shadow-lg">
          <div className="rounded-full bg-primary/10 p-4">
            <svg
              className="h-6 w-6 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
          </div>
          <h3 className="text-xl font-bold">Track Requirements</h3>
          <p className="text-muted-foreground">
            Easily monitor your progress towards graduation requirements
          </p>
        </div>

        <div className="flex flex-col items-center space-y-2 rounded-lg p-6 text-center transition-all hover:bg-accent hover:shadow-lg">
          <div className="rounded-full bg-primary/10 p-4">
            <svg
              className="h-6 w-6 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h3 className="text-xl font-bold">Plan Schedules</h3>
          <p className="text-muted-foreground">
            Build and compare different course schedules across terms
          </p>
        </div>

        <div className="flex flex-col items-center space-y-2 rounded-lg p-6 text-center transition-all hover:bg-accent hover:shadow-lg">
          <div className="rounded-full bg-primary/10 p-4">
            <svg
              className="h-6 w-6 text-primary"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
              />
            </svg>
          </div>
          <h3 className="text-xl font-bold">Course Ratings</h3>
          <p className="text-muted-foreground">
            Make informed decisions with real student ratings and reviews
          </p>
        </div>
      </div>

      {/* About Section */}
      <div id="about" className="w-full scroll-mt-16">
        <div className="container mx-auto px-4 py-16">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-8 text-center text-4xl font-bold tracking-tighter sm:text-5xl">
              About UWPlan
            </h2>

            {/* Mission Section */}
            <section className="mb-16">
              <h2 className="mb-4 text-2xl font-bold">Our Mission</h2>
              <p className="mb-6 text-lg text-muted-foreground">
                UWPlan was created to simplify the complex process of degree
                planning for University of Waterloo students. We believe that
                every student should have access to the tools and information
                they need to make informed decisions about their academic
                journey.
              </p>
              <p className="text-lg text-muted-foreground">
                By combining course information, student ratings, and an
                intelligent planning system, we help students create optimal
                degree plans that meet all their requirements while considering
                their interests and goals.
              </p>
            </section>

            {/* Built For Students Section */}
            <section className="mb-16">
              <h2 className="mb-4 text-2xl font-bold">
                Built For Students, By Students
              </h2>
              <p className="mb-6 text-lg text-muted-foreground">
                As UWaterloo students ourselves, we understand the challenges of
                planning courses and meeting degree requirements. UWPlan was
                built with the specific needs of UWaterloo students in mind,
                integrating with existing tools like UWFlow to provide a
                comprehensive planning experience.
              </p>
            </section>

            {/* Open Source Section */}
            <section className="mb-16">
              <h2 className="mb-4 text-2xl font-bold">Open Source</h2>
              <p className="mb-6 text-lg text-muted-foreground">
                UWPlan is open source and built with modern web technologies. We
                believe in transparency and community contribution. Check out
                our GitHub repository to see how you can contribute to making
                UWPlan even better.
              </p>
              <div className="flex justify-center">
                <a
                  href="https://github.com/pl3lee/uwplan"
                  className="inline-flex items-center space-x-2 text-primary hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg
                    className="h-5 w-5"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12" />
                  </svg>
                  <span>View on GitHub</span>
                </a>
              </div>
            </section>
          </div>
        </div>
      </div>
      {/* Detailed Features Section */}
      <div id="features" className="w-full scroll-mt-16 bg-muted/50">
        <div className="container mx-auto px-4 py-16">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-4xl font-bold tracking-tighter sm:text-5xl">
              Features
            </h2>
            <p className="mx-auto max-w-2xl text-xl text-muted-foreground">
              Everything you need to plan your University of Waterloo degree
              journey
            </p>
          </div>

          <div className="mt-16 grid gap-12">
            {/* Feature 1: Course Planning */}
            <div className="grid items-center gap-8 md:grid-cols-2">
              <div>
                <h2 className="mb-4 text-3xl font-bold">
                  Smart Course Planning
                </h2>
                <p className="mb-6 text-lg text-muted-foreground">
                  Plan your entire degree with our intelligent course selection
                  system. We help you track degree requirements and course
                  availability.
                </p>
                <ul className="mb-6 space-y-2">
                  <li className="flex items-center">
                    <svg
                      className="mr-2 h-5 w-5 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Term-by-term schedule planning
                  </li>
                  <li className="flex items-center">
                    <svg
                      className="mr-2 h-5 w-5 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Degree requirement tracking
                  </li>
                </ul>
              </div>
              <div className="flex h-[300px] items-center justify-center rounded-lg bg-muted p-6">
                [Screenshot Placeholder]
              </div>
            </div>

            {/* Feature 2: Course Ratings */}
            <div className="grid items-center gap-8 md:grid-cols-2">
              <div className="order-2 flex h-[300px] items-center justify-center rounded-lg bg-muted p-6 md:order-1">
                [Screenshot Placeholder]
              </div>
              <div className="order-1 md:order-2">
                <h2 className="mb-4 text-3xl font-bold">
                  Course Ratings & Reviews
                </h2>
                <p className="mb-6 text-lg text-muted-foreground">
                  Make informed decisions about your courses using real data
                  from UWFlow and feedback from fellow students.
                </p>
                <ul className="mb-6 space-y-2">
                  <li className="flex items-center">
                    <svg
                      className="mr-2 h-5 w-5 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Course difficulty ratings
                  </li>
                  <li className="flex items-center">
                    <svg
                      className="mr-2 h-5 w-5 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Usefulness ratings
                  </li>
                  <li className="flex items-center">
                    <svg
                      className="mr-2 h-5 w-5 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Real student feedback
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="w-full border-t">
        <div className="mx-auto max-w-5xl px-4 py-12">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {/* Product */}
            <div className="space-y-4">
              <h4 className="text-lg font-semibold">Product</h4>
              <ul className="space-y-2">
                <li>
                  <Link
                    href="#features"
                    className="text-muted-foreground hover:text-primary"
                  >
                    Features
                  </Link>
                </li>
                <li>
                  <Link
                    href="#about"
                    className="text-muted-foreground hover:text-primary"
                  >
                    About
                  </Link>
                </li>
                <li>
                  <Link
                    href="/privacy"
                    className="text-muted-foreground hover:text-primary"
                  >
                    Privacy Policy
                  </Link>
                </li>
              </ul>
            </div>

            {/* Social */}
            <div className="space-y-4">
              <h4 className="text-lg font-semibold">Connect</h4>
              <div className="flex space-x-4">
                <a
                  href="https://github.com/pl3lee/uwplan"
                  className="text-muted-foreground hover:text-primary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg
                    className="h-6 w-6"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12" />
                  </svg>
                </a>
              </div>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="mt-12 border-t pt-8">
            <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
              <p className="text-sm text-muted-foreground">
                © {new Date().getFullYear()} UWPlan. All rights reserved.
              </p>
              <p className="text-sm text-muted-foreground">
                Made with ❤️ for University of Waterloo students
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
