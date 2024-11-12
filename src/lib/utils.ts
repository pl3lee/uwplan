import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function normalizeCourseCode(code: string) {
  // Remove all spaces and convert to uppercase
  return code.replace(/\s+/g, '').toUpperCase();
}