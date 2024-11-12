import styles from "@/styles/utils.module.css";
import {
  getCoursesWithRatings,
  getSelectedCourses,
  getUserTemplatesWithCourses,
} from "@/server/db/queries";
import { CourseTable } from "@/components/CourseTable";
import { auth } from "@/server/auth";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { FixedCourse } from "@/types/course";

export default async function SelectPage() {
  const session = await auth();
  if (!session?.user) {
    return <div>Please sign in to view your requirements</div>;
  }

  const [templates, allCourses, selectedCourses] = await Promise.all([
    getUserTemplatesWithCourses(session.user.id),
    getCoursesWithRatings(),
    getSelectedCourses(session.user.id),
  ]);

  const selectedCoursesWithDetails = selectedCourses
    .map(({ courseId }) => {
      const course = allCourses.find((course) => course.id === courseId);
      return course ? { course } : undefined;
    })
    .filter((course): course is FixedCourse => course !== undefined);

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
          <CourseTable
            fixedCourses={selectedCoursesWithDetails}
            allCourses={allCourses}
            selectedCourses={
              new Set(selectedCourses.map((course) => course.courseId))
            }
          />
        </CardContent>
      </Card>
      {templates.map((template) => (
        <Card key={template.id} className="mt-6">
          <CardHeader>
            <CardTitle className="text-lg font-medium">
              {template.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {template.items.map((item) => (
              <div key={item.id} className="mt-4">
                {item.type === "requirement" && (
                  <>
                    <h3 className="text-md mb-2 text-foreground">
                      {item.description}
                    </h3>
                    <CourseTable
                      fixedCourses={item.fixedCourses}
                      freeCourses={item.freeCourses}
                      allCourses={allCourses}
                      selectedCourses={
                        new Set(
                          selectedCourses.map((course) => course.courseId),
                        )
                      }
                    />
                  </>
                )}
                {item.type === "instruction" && (
                  <h3 className="mb-2 text-xl font-medium text-accent-foreground">
                    {item.description}
                  </h3>
                )}
                {item.type === "separator" && (
                  <Separator className="mt-8 bg-red-600" />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
