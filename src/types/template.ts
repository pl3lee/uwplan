import { type InferSelectModel } from "drizzle-orm";
import {
  templates,
  templateItems,
} from "@/server/db/schema";

export type Template = InferSelectModel<typeof templates>;

export type TemplateItem = InferSelectModel<typeof templateItems>;

export type RequirementItem = {
  type: "requirement";
  description: string;
  orderIndex: number;
  courseType: "fixed" | "free";
  courses: string[];
  courseCount?: number;
};

export type InstructionItem = {
  type: "instruction";
  description: string;
  orderIndex: number;
};

export type SeparatorItem = {
  type: "separator";
  orderIndex: number;
};

