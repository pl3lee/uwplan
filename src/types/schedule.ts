export type Season = "Fall" | "Winter" | "Spring";

export const Seasons: Season[] = ["Fall", "Winter", "Spring"];

export type Term = {
  name: string; // e.g. "Fall 2024"
};

export type TermCourseInstance = {
  courseId: string;
  term: string;
  courseCode: string;
  courseName: string;
};

export type Schedule = {
  id: string;
  name: string;
};