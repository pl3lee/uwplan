import "dotenv/config";
import { db } from "@/server/db";
import { courses } from "@/server/db/schema";

type UWFlowCourseResponse = {
  data: {
    course_search_index: Array<{
      course_id: number;
      name: string;
      code: string;
      useful: number | null;
      liked: number | null;
      easy: number | null;
      ratings: number;
      __typename: string;
    }>;
  };
};

async function fetchUWFlowCourses() {
  try {
    console.log("Fetching courses from UWFlow...");

    const res = await fetch("https://uwflow.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        operationName: "exploreAll",
        variables: {},
        query: "query exploreAll { course_search_index { ...CourseSearch __typename } } fragment CourseSearch on course_search_index { course_id name code useful ratings liked easy __typename }",
      }),
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch from UWFlow: ${res.statusText}`);
    }

    const { data }: UWFlowCourseResponse = await res.json();
    console.log(`Fetched ${data.course_search_index.length} courses`);

    // Process courses in batches to avoid overwhelming the database
    const BATCH_SIZE = 100;
    for (let i = 0; i < data.course_search_index.length; i += BATCH_SIZE) {
      const batch = data.course_search_index.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map((course) =>
          db
            .insert(courses)
            .values({
              code: course.code.toUpperCase(), // Ensure consistent casing
              name: course.name,
              usefulRating: course.useful,
              likedRating: course.liked,
              easyRating: course.easy,
              numRatings: course.ratings, // Changed from generalRating to numRatings
            })
            .onConflictDoUpdate({
              target: [courses.code],
              set: {
                name: course.name,
                usefulRating: course.useful,
                likedRating: course.liked,
                easyRating: course.easy,
                numRatings: course.ratings, // Changed here too
              },
            })
        )
      );

      console.log(`Processed ${Math.min(i + BATCH_SIZE, data.course_search_index.length)} courses`);
    }

    console.log("Successfully updated course database!");
  } catch (error) {
    console.error("Failed to fetch and update courses:", error);
    throw error;
  }
}

// Run the script
fetchUWFlowCourses()
  .then(() => {
    console.log("Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Script failed:", error);
    process.exit(1);
  });
