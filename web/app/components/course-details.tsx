import type { CourseBody } from "~/generated/api/model";

export function CourseDetails({ course }: { course: CourseBody }) {
  return (
    <div className="space-y-2 text-sm">
      {[
        ["Description", course.description],
        ["Prerequisites", course.prereqs],
        ["Antirequisites", course.antireqs],
        ["Corequisites", course.coreqs],
      ].map(
        ([label, value]) =>
          value && (
            <div key={label}>
              <span className="font-medium">{label}: </span>
              <span className="text-muted-foreground">{value}</span>
            </div>
          ),
      )}
    </div>
  );
}
