import { CourseInstance } from "./course";

export type Term = {
  name: string; // e.g. "Fall 2024"
};

export type TermCourseInstance = {
  courseId: string;
  term: string;
  courseCode: string,
  courseName: string,
};

export type Schedule = {
  id: string;
  name: string;
};