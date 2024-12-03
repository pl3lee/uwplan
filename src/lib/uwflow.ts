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

type UWFlowCourseDetailResponse = {
  data: {
    course: Array<{
      id: number;
      code: string;
      name: string;
      description: string;
      antireqs: string;
      prereqs: string;
      coreqs: string;
    }>;
  };
};

// Add a new type for the course with details
type CourseWithDetails = UWFlowCourseResponse["data"]["course_search_index"][0] & {
  description: string;
  antireqs: string;
  prereqs: string;
  coreqs: string;
};

// Helper function to wait between requests
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to retry failed requests
async function retry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries > 0) {
      await delay(delayMs);
      return retry(fn, retries - 1, delayMs * 2);
    }
    throw error;
  }
}

async function fetchCourseDetails(code: string): Promise<UWFlowCourseDetailResponse['data']['course'][0] | null> {
  return retry(async () => {
    const res = await fetch("https://uwflow.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        operationName: "getCourse",
        variables: { code },
        query: "query getCourse($code: String) { course(where: {code: {_eq: $code}}) { id code name description antireqs prereqs coreqs __typename }}",
      }),
    });

    if (!res.ok) return null;

    const data: UWFlowCourseDetailResponse = (await res.json()) as UWFlowCourseDetailResponse;
    return data.data.course[0] ?? null;
  });
}

// Helper function to process courses in batches with proper typing
async function processBatch<T, R>(
  items: T[],
  batchSize: number,
  processFn: (item: T) => Promise<R | null>
): Promise<R[]> {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    console.log(`Processing batch ${i / batchSize + 1} of ${Math.ceil(items.length / batchSize)}...`);
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          return await processFn(item);
        } catch (error) {
          console.error(`Failed to process item:`, error);
          return null;
        }
      })
    );
    results.push(...batchResults.filter(Boolean));
    // Wait between batches to avoid overloading the API
    await delay(1000);
  }
  return results as R[];
}

export async function fetchUWFlowData(): Promise<CourseWithDetails[]> {
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
  console.log(`Fetched ${data.course_search_index.length} courses, fetching details...`);

  // Process courses in smaller batches with proper typing
  const coursesWithDetails = await processBatch(
    data.course_search_index,
    30, // batch size
    async (course): Promise<CourseWithDetails | null> => {
      const details = await fetchCourseDetails(course.code.toLowerCase());
      return {
        ...course,
        description: details?.description ?? '',
        antireqs: details?.antireqs ?? '',
        prereqs: details?.prereqs ?? '',
        coreqs: details?.coreqs ?? '',
      };
    }
  );

  return coursesWithDetails;
}

// Update the insertUWFlowCourses type to use CourseWithDetails
export async function insertUWFlowCourses(courseData: CourseWithDetails[]) {
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
            description: course.description,
            antireqs: course.antireqs,
            prereqs: course.prereqs,
            coreqs: course.coreqs,
          })
          .onConflictDoUpdate({
            target: [courses.code],
            set: {
              name: course.name,
              usefulRating: course.useful?.toString() ?? null,
              likedRating: course.liked?.toString() ?? null,
              easyRating: course.easy?.toString() ?? null,
              numRatings: course.ratings,
              description: course.description,
              antireqs: course.antireqs,
              prereqs: course.prereqs,
              coreqs: course.coreqs,
            },
          })
      )
    );
  }
  console.log("Successfully updated course database!");
}

export async function fetchCourses() {
  try {
    const courseData = await fetchUWFlowData();
    await insertUWFlowCourses(courseData);
  } catch (e) {
    console.error(e);
  }
}