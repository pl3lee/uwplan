import { CourseInstance } from "./course";

export type Term = {
  name: string; // e.g. "Fall 2024"
  id: string; // Unique identifier for the term
  courses: TermCourseInstance[];
};

export type TermCourseInstance = {
  instanceId: string; // Unique ID for this instance in the term
  courseItemId: string; // Reference to the original course
};

export type Schedule = {
  id: string;
  name: string;
};