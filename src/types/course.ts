import { type InferSelectModel } from "drizzle-orm";
import {
  type courses,
  type courseItems
} from "@/server/db/schema";

export type Course = InferSelectModel<typeof courses>;

export type CourseItems = InferSelectModel<typeof courseItems>;

export type FixedCourse = {
  course: Course;
};

export type FreeCourse = {
  courseItemId: string;
  course: Course | null;
};

export type CourseInstance = {
  instanceId: string;
  courseItemId: string;
};