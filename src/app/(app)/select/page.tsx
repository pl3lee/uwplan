import { CourseTable } from "@/app/(app)/select/CourseTable";
import { ScrollToTopButton } from "@/components/nav/ScrollToTopButton";
import { SelectedCoursesTable } from "@/app/(app)/select/SelectedCoursesTable";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { auth } from "@/server/auth";
import {
  getCoursesWithRatings,
  getSelectedCourses,
  getUserTemplatesWithCourses,
} from "@/server/db/queries";
import styles from "@/styles/utils.module.css";
import { redirect } from "next/navigation";
import { type Metadata } from "next";

export const metadata: Metadata = {
  title: "UWPlan - Select Courses",
};

export default async function SelectPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/signin");
  }

  const [templates, allCourses, selectedCourses] = await Promise.all([
    getUserTemplatesWithCourses(session.user.id),
    getCoursesWithRatings(),
    getSelectedCourses(session.user.id),
  ]);

  // Map courses to their details for the selected courses section and deduplicate
  const selectedCoursesWithDetails = Array.from(
    selectedCourses
      .reduce((map, { courseId, courseItemId }) => {
        if (!courseId) return map;
        const course = allCourses.find((course) => course.id === courseId);
        if (!course) return map;
        if (!map.has(course.id)) {
          map.set(course.id, { courseItemId, course });
        }
        return map;
      }, new Map<string, { courseItemId: string; course: (typeof allCourses)[number] }>())
      .values(),
  );

  const selectedCourseItems = new Set(
    selectedCourses.map((course) => course.courseItemId),
  );

  return (
    <div className="container mx-auto py-10">
      <h1 className={styles.pageTitleText}>Select Your Courses</h1>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg font-medium">
            Your Selected Courses
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SelectedCoursesTable fixedCourses={selectedCoursesWithDetails} />
        </CardContent>
      </Card>
      {templates.map((template) => (
        <Card key={template.id} className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg font-medium">
              {template.name}
            </CardTitle>
            <CardDescription>{template.description}</CardDescription>
          </CardHeader>
          <CardContent>
            {template.items.map((item) => (
              <div key={item.id} className="mt-6">
                {item.type === "requirement" && (
                  <>
                    <h3 className="text-md mb-2 text-card-foreground">
                      {item.description}
                    </h3>
                    <CourseTable
                      fixedCourses={item.fixedCourses.map((fc) => ({
                        courseItemId: fc.courseItemId,
                        course: fc.course,
                      }))}
                      freeCourses={item.freeCourses}
                      allCourses={allCourses}
                      selectedCourseItems={selectedCourseItems}
                      otherSelectedCourses={selectedCoursesWithDetails.map(
                        (course) => course.course.id,
                      )}
                    />
                  </>
                )}
                {item.type === "instruction" && (
                  <h3 className="mb-2 text-lg font-medium text-accent-foreground">
                    {item.description}
                  </h3>
                )}
                {item.type === "separator" && (
                  <Separator className="mt-8 h-2 bg-gradient-to-r from-primary/5 via-primary/30 to-primary/5" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <ScrollToTopButton />
    </div>
  );
}
