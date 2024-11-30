import { CourseInstance } from "./course";
import { type InferSelectModel } from "drizzle-orm";
import { type seasonEnum } from "@/server/db/schema";

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