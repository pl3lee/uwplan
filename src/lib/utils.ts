import { type CourseOption, type FormItem, type formSchema } from "@/app/(app)/create/template/TemplateForm";
import { type Term } from "@/types/schedule";
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { type z } from "zod";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizeCourseCode(code: string) {
  // Remove all spaces and convert to uppercase
  return code.replace(/\s+/g, '').toUpperCase();
}

// Change SEASONS order to match academic year
const SEASONS = ["Winter", "Spring", "Fall"] as const;

export function generateTerms(
  startTerm: { season: string; year: number },
  endTerm: { season: string; year: number },
): Term[] {
  const terms: Term[] = [];

  // Handle invalid range
  if (
    startTerm.year > endTerm.year ||
    (startTerm.year === endTerm.year &&
      SEASONS.indexOf(startTerm.season as (typeof SEASONS)[number]) >
      SEASONS.indexOf(endTerm.season as (typeof SEASONS)[number]))
  ) {
    return terms;
  }

  let currentYear = startTerm.year;
  let currentSeasonIndex = SEASONS.indexOf(
    startTerm.season as (typeof SEASONS)[number],
  );

  while (
    currentYear < endTerm.year ||
    (currentYear === endTerm.year &&
      currentSeasonIndex <=
      SEASONS.indexOf(endTerm.season as (typeof SEASONS)[number]))
  ) {
    terms.push({
      name: `${SEASONS[currentSeasonIndex]} ${currentYear}`,
    });

    currentSeasonIndex++;
    if (currentSeasonIndex >= SEASONS.length) {
      currentSeasonIndex = 0;
      currentYear++;
    }
  }

  return terms
}


export function validateCreateTemplateFormCourseCodes(items: FormItem[], courseOptions: CourseOption[]) {
  const errors: string[] = [];

  items.forEach((item, index) => {
    if (item.type === "requirement" && item.courseType === "fixed") {
      const courseCodes = item.courses.split(",").map((code) => normalizeCourseCode(code.trim()));
      const invalidCodes = courseCodes.filter((code) => !courseOptions.some((opt) => opt.code === code));

      if (invalidCodes.length > 0) {
        errors.push(`Invalid codes in "${getTemplateFormItemTitle(item, index)}": ${invalidCodes.join(", ")}`);
      }
    }
  });

  return errors;
}

export function getTemplateFormItemTitle(field: FormItem, index: number) {
  return `Item ${index + 1}: ${field.type === "separator" || field.type === "instruction"
    ? String(field.type[0]).toUpperCase() +
    field.type.slice(1)
    : field.courseType === "free"
      ? "Free Requirement"
      : "Fixed Requirement"
    }`
}

export function transformTemplateFormData(data: z.infer<typeof formSchema>) {
  return {
    name: data.name,
    description: data.description,
    items: data.items.map((item, index) => {
      if (item.type === "instruction") {
        return {
          type: "instruction" as const,
          description: item.description,
          orderIndex: index,
        };
      } else if (item.type === "separator") {
        return {
          type: "separator" as const,
          orderIndex: index,
        };
      } else if (
        item.type === "requirement" &&
        item.courseType === "fixed"
      ) {
        return {
          type: "requirement" as const,
          courseType: "fixed" as const,
          description: item.description,
          courses: item.courses
            .split(",")
            .map((c) => normalizeCourseCode(c.trim())),
          orderIndex: index,
        };
      } else if (
        item.type === "requirement" &&
        item.courseType === "free"
      ) {
        return {
          type: "requirement" as const,
          courseType: "free" as const,
          description: item.description,
          courses: [],
          courseCount: item.count,
          orderIndex: index,
        };
      }
      return item;
    }),
  }
}