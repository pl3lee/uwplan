import "dotenv/config";
import { db } from "@/server/db";
import { fetchUWFlowData, insertUWFlowCourses } from "@/scripts/fetchUWFlowCourses";
import {
  courses,
  templates,
  templateItems,
  templateRequirementCourses,
} from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { type InferSelectModel } from 'drizzle-orm';

// Add type definitions
type Template = InferSelectModel<typeof templates>;
type TemplateItem = InferSelectModel<typeof templateItems>;

// Helper function to find course ID with better type safety
const findCourse = async (code: string) => {
  const found = await db
    .select()
    .from(courses)
    .where(eq(courses.code, code))
    .limit(1);
  if (!found[0]) throw new Error(`Course ${code} not found`);
  return found[0].id;
};



async function main() {
  // Clear existing data
  console.log("Clearing existing data...");
  await db.delete(templateRequirementCourses);
  await db.delete(templateItems);
  await db.delete(templates);
  await db.delete(courses);

  // Fetch and populate courses from UWFlow
  console.log("Fetching and inserting UWFlow courses...");
  const courseData = await fetchUWFlowData();
  await insertUWFlowCourses(courseData);

  console.log("Creating templates and requirements...");
  // Create templates with proper typing
  const createdTemplates = await db
    .insert(templates)
    .values([
      { name: "Computational Mathematics Major", description: "A major combining mathematics and computational methods" },
      { name: "Combinatorics & Optimization Major", description: "A major focusing on discrete mathematics and optimization" },
    ])
    .returning();

  // Type assertion with runtime check
  if (createdTemplates.length !== 2) {
    throw new Error("Failed to create both templates");
  }

  const [compMathTemplate, coTemplate] = createdTemplates as [Template, Template];

  // Create Computational Mathematics template items
  const compMathItems = await db
    .insert(templateItems)
    .values([
      // First year section
      {
        templateId: compMathTemplate.id,
        type: "separator",
        description: "First Year Requirements",
        orderIndex: 0,
      },
      {
        templateId: compMathTemplate.id,
        type: "instruction",
        description: "Complete all of the following courses in your first year:",
        orderIndex: 1,
      },
      {
        templateId: compMathTemplate.id,
        type: "requirement",
        description: "Required Core Courses",
        orderIndex: 2,
      },
      // Second year section
      {
        templateId: compMathTemplate.id,
        type: "separator",
        description: "Second Year Options",
        orderIndex: 3,
      },
      {
        templateId: compMathTemplate.id,
        type: "instruction",
        description: "Choose at least one course from each of the following groups:",
        orderIndex: 4,
      },
      {
        templateId: compMathTemplate.id,
        type: "requirement",
        description: "Choose one computational course",
        orderIndex: 5,
      },
      {
        templateId: compMathTemplate.id,
        type: "requirement",
        description: "Choose one advanced course",
        orderIndex: 6,
      },
    ])
    .returning();

  // Create C&O template items
  const coItems = await db
    .insert(templateItems)
    .values([
      // Core requirements section
      {
        templateId: coTemplate.id,
        type: "separator",
        description: "Core Mathematics Requirements",
        orderIndex: 0,
      },
      {
        templateId: coTemplate.id,
        type: "instruction",
        description: "These courses form the foundation of your major:",
        orderIndex: 1,
      },
      {
        templateId: coTemplate.id,
        type: "requirement",
        description: "Required Mathematics Courses",
        orderIndex: 2,
      },
      // Advanced requirements section
      {
        templateId: coTemplate.id,
        type: "separator",
        description: "Advanced Requirements",
        orderIndex: 3,
      },
      {
        templateId: coTemplate.id,
        type: "instruction",
        description: "Select advanced courses to specialize in combinatorics or optimization:",
        orderIndex: 4,
      },
      {
        templateId: coTemplate.id,
        type: "requirement",
        description: "Choose one combinatorics course",
        orderIndex: 5,
      },
      {
        templateId: coTemplate.id,
        type: "requirement",
        description: "Choose one optimization course",
        orderIndex: 6,
      },
    ])
    .returning();

  // Type assertion helper for array index access
  const getItemId = (items: typeof compMathItems, index: number) => {
    const item = items[index];
    if (!item) throw new Error(`Template item at index ${index} not found`);
    return item.id;
  };

  // Link courses to templates steps:
  console.log("Linking courses to templates...");

  // Core courses - Computational Mathematics
  console.log("Processing Computational Mathematics requirements...");
  const compMathPromises = [
    // Core courses
    Promise.all(
      ['MATH137', 'MATH138', 'CS115'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(templateRequirementCourses).values({
          itemId: getItemId(compMathItems, 2),
          courseId,
        });
      })
    ),
    // Computational options
    Promise.all(
      ['AMATH242', 'CS371'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(templateRequirementCourses).values({
          itemId: getItemId(compMathItems, 5),
          courseId,
        });
      })
    ),
    // Advanced options
    Promise.all(
      ['AMATH331', 'AMATH342'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(templateRequirementCourses).values({
          itemId: getItemId(compMathItems, 6),
          courseId,
        });
      })
    ),
  ];

  // C&O courses
  console.log("Processing C&O requirements...");
  const coPromises = [
    // Core courses
    Promise.all(
      ['MATH137', 'MATH138', 'MATH239'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(templateRequirementCourses).values({
          itemId: getItemId(coItems, 2),
          courseId,
        });
      })
    ),
    // Combinatorics options
    Promise.all(
      ['CO342', 'MATH239'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(templateRequirementCourses).values({
          itemId: getItemId(coItems, 5),
          courseId,
        });
      })
    ),
    // Optimization options
    Promise.all(
      ['CO250', 'CO351'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(templateRequirementCourses).values({
          itemId: getItemId(coItems, 6),
          courseId,
        });
      })
    ),
  ];

  // Wait for all promises to complete
  await Promise.all([
    ...compMathPromises,
    ...coPromises,
  ]);

  console.log("Database seeded successfully!");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Failed to seed database:", err);
  process.exit(1);
});
