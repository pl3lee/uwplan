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

// Function to only fetch the data
export async function fetchUWFlowData() {
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

  const { data }: UWFlowCourseResponse = (await res.json()) as UWFlowCourseResponse;
  console.log(`Fetched ${data.course_search_index.length} courses`);
  return data.course_search_index;
}

// Function to insert the data
export async function insertUWFlowCourses(courseData: UWFlowCourseResponse["data"]["course_search_index"]) {
  const BATCH_SIZE = 100;
  for (let i = 0; i < courseData.length; i += BATCH_SIZE) {
    const batch = courseData.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((course) =>
        db
          .insert(courses)
          .values({
            code: course.code.toUpperCase(),
            name: course.name,
            usefulRating: course.useful?.toString() ?? null,
            likedRating: course.liked?.toString() ?? null,
            easyRating: course.easy?.toString() ?? null,
            numRatings: course.ratings,
          })
          .onConflictDoUpdate({
            target: [courses.code],
            set: {
              name: course.name,
              usefulRating: course.useful?.toString() ?? null,
              likedRating: course.liked?.toString() ?? null,
              easyRating: course.easy?.toString() ?? null,
              numRatings: course.ratings
            },
          })
      )
    );
  }
  console.log("Successfully updated course database!");
}
