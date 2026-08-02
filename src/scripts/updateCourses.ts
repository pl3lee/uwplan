import { fetchCourses } from "@/lib/uwflow";
import {
  writeApplicationError,
  writeStructuredLog,
} from "@/lib/structured-log";

async function main() {
  try {
    await fetchCourses();
    writeStructuredLog("info", "course-update.completed");
    process.exit(0);
  } catch (error) {
    writeApplicationError("course-update.failed", error);
    process.exit(1);
  }
}

main().catch((error) => {
  writeApplicationError("course-update.unhandled", error);
  process.exit(1);
});
