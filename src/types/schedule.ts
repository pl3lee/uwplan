import { CourseInstance } from "./course";

export type Term = {
  id: string;
  name: string; // e.g. "Fall 2024"
  courses: CourseInstance[]; // courseIds
};

export type Schedule = {
  id: string;
  name: string;
};