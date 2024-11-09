import "dotenv/config";
import { db } from "@/server/db";
import { fetchUWFlowData, insertUWFlowCourses } from "@/scripts/fetchUWFlowCourses";
import {
  courses,
  templates,
  templateItems,
  courseItems,
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
  await db.delete(courseItems);
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
        type: "requirement",
        description: "Complete all of the following:",
        orderIndex: 0,
        // cs230, cs234
      },
      {
        templateId: compMathTemplate.id,
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 1,
        // amath242, cs371
      },
      {
        templateId: compMathTemplate.id,
        type: "requirement",
        description: "Complete 1 of the following",
        orderIndex: 2,
        // math237, math247
      },
      {
        templateId: compMathTemplate.id,
        type: "requirement",
        description: "Complete 1 of the following",
        orderIndex: 3,
        // math239, math249
      },
      {
        templateId: compMathTemplate.id,
        type: "separator",
        description: "",
        orderIndex: 4,
      },
      {
        templateId: compMathTemplate.id,
        type: "instruction",
        description: "Complete 2 of the following",
        orderIndex: 5,
      },
      {
        templateId: compMathTemplate.id,
        type: "requirement",
        description: "Complete 1 of the following",
        orderIndex: 6,
        // amath250, amath251, amath350
      },
      {
        templateId: compMathTemplate.id,
        type: "requirement",
        description: "Complete 1 of the following",
        orderIndex: 7,
        // co250, co255
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
    Promise.all(
      ['CS230', 'CS234'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(courseItems).values({
          requirementId: getItemId(compMathItems, 0),
          courseId,
          type: "fixed",
        });
      })
    ),
    Promise.all(
      ['AMATH242', 'CS371'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(courseItems).values({
          requirementId: getItemId(compMathItems, 1),
          courseId,
          type: "fixed",
        });
      })
    ),
    Promise.all(
      ['MATH237', 'MATH247'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(courseItems).values({
          requirementId: getItemId(compMathItems, 2),
          courseId,
          type: "fixed",
        });
      })
    ),
    Promise.all(
      ['MATH239', 'MATH249'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(courseItems).values({
          requirementId: getItemId(compMathItems, 3),
          courseId,
          type: "fixed",
        });
      })
    ),
    Promise.all(
      ['AMATH250', 'AMATH251', 'AMATH350'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(courseItems).values({
          requirementId: getItemId(compMathItems, 6),
          courseId,
          type: "fixed",
        });
      })
    ),
    Promise.all(
      ['CO250', 'CO255'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(courseItems).values({
          requirementId: getItemId(compMathItems, 7),
          courseId,
          type: "fixed",
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
        return db.insert(courseItems).values({
          requirementId: getItemId(coItems, 2),
          courseId,
          type: "fixed",
        });
      })
    ),
    // Combinatorics options
    Promise.all(
      ['CO342', 'MATH239'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(courseItems).values({
          requirementId: getItemId(coItems, 5),
          courseId,
          type: "fixed",
        });
      })
    ),
    // Optimization options
    Promise.all(
      ['CO250', 'CO351'].map(async (code) => {
        const courseId = await findCourse(code);
        return db.insert(courseItems).values({
          requirementId: getItemId(coItems, 6),
          courseId,
          type: "fixed",
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
