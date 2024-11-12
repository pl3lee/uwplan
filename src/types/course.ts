export type Course = {
  id: string;
  code: string;
  name: string;
  usefulRating: string | null;
  likedRating: string | null;
  easyRating: string | null;
  numRatings: number | null;
};

export type FixedCourse = {
  course: Course;
};

export type FreeCourse = {
  courseItemId: string;
  course: Course | null;
};
