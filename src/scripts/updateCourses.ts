import { fetchCourses } from "@/lib/uwflow";

async function main() {
  try {
    await fetchCourses();
    console.log("Course update completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Failed to update courses:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
