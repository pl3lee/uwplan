import { Term } from "@/types/schedule";
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

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
      id: `${SEASONS[currentSeasonIndex]}-${currentYear}`,
      name: `${SEASONS[currentSeasonIndex]} ${currentYear}`,
      courses: [],
    });

    currentSeasonIndex++;
    if (currentSeasonIndex >= SEASONS.length) {
      currentSeasonIndex = 0;
      currentYear++;
    }
  }

  return terms.map((term) => ({
    name: term.name,
    id: `term-${term.name.replace(" ", "-")}`,
    courses: term.courses,
  }));
}