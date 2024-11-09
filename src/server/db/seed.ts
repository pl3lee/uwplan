import "dotenv/config";
import { db } from "@/server/db";
import {
  courses,
  templates,
  templateItems,
  templateRequirementCourses,
  userTemplates,
  userPlanCourses,
  plans,
  items,
  requirementCourses,
} from "@/server/db/schema";

async function main() {
  // Clear existing data in correct order (following foreign key dependencies)
  await db.delete(userPlanCourses);
  await db.delete(requirementCourses);
  await db.delete(templateRequirementCourses);
  await db.delete(items);
  await db.delete(templateItems);
  await db.delete(plans);
  await db.delete(userTemplates);
  await db.delete(courses);
  await db.delete(templates);

  // Insert core courses
  const coursesData = await db
    .insert(courses)
    .values([
      // Core math courses
      { code: "MATH137", name: "Calculus 1", rating: null, difficulty: null, workload: null },
      { code: "MATH138", name: "Calculus 2", rating: null, difficulty: null, workload: null },
      { code: "MATH237", name: "Calculus 3 for Honours Mathematics", rating: null, difficulty: null, workload: null },
      { code: "MATH239", name: "Introduction to Combinatorics", rating: null, difficulty: null, workload: null },

      // CS courses
      { code: "CS115", name: "Introduction to Computer Science 1", rating: null, difficulty: null, workload: null },
      { code: "CS136", name: "Algorithm Design and Data Abstraction", rating: null, difficulty: null, workload: null },
      { code: "CS234", name: "Data Types and Structures", rating: null, difficulty: null, workload: null },
      { code: "CS371", name: "Introduction to Computational Mathematics", rating: null, difficulty: null, workload: null },

      // CO courses
      { code: "CO250", name: "Introduction to Optimization", rating: null, difficulty: null, workload: null },
      { code: "CO342", name: "Introduction to Graph Theory", rating: null, difficulty: null, workload: null },
      { code: "CO351", name: "Network Flow Theory", rating: null, difficulty: null, workload: null },

      // AMATH courses
      { code: "AMATH242", name: "Introduction to Computational Mathematics", rating: null, difficulty: null, workload: null },
      { code: "AMATH331", name: "Applied Real Analysis", rating: null, difficulty: null, workload: null },
      { code: "AMATH342", name: "Computational Methods for Differential Equations", rating: null, difficulty: null, workload: null },
    ])
    .returning();

  // Create templates
  const [compMathTemplate, coTemplate] = await db
    .insert(templates)
    .values([
      { name: "Computational Mathematics Major" },
      { name: "Combinatorics & Optimization Major" },
    ])
    .returning();

  // Create Computational Mathematics template items
  const compMathItems = await db
    .insert(templateItems)
    .values([
      {
        templateId: compMathTemplate.id,
        type: "requirement",
        description: "Required Core Courses",
        orderIndex: 1,
      },
      {
        templateId: compMathTemplate.id,
        type: "requirement",
        description: "Choose one computational course",
        orderIndex: 2,
      },
      {
        templateId: compMathTemplate.id,
        type: "requirement",
        description: "Choose one advanced course",
        orderIndex: 3,
      },
    ])
    .returning();

  // Create C&O template items
  const coItems = await db
    .insert(templateItems)
    .values([
      {
        templateId: coTemplate.id,
        type: "requirement",
        description: "Required Mathematics Courses",
        orderIndex: 1,
      },
      {
        templateId: coTemplate.id,
        type: "requirement",
        description: "Choose one combinatorics course",
        orderIndex: 2,
      },
      {
        templateId: coTemplate.id,
        type: "requirement",
        description: "Choose one optimization course",
        orderIndex: 3,
      },
    ])
    .returning();

  // Helper function to find course ID
  const findCourse = (code: string) => {
    const course = coursesData.find(c => c.code === code);
    if (!course) throw new Error(`Course ${code} not found`);
    return course.id;
  };

  // Link courses to Computational Mathematics requirements
  await db.insert(templateRequirementCourses).values([
    // Core courses
    { itemId: compMathItems[0].id, courseId: findCourse("MATH137") },
    { itemId: compMathItems[0].id, courseId: findCourse("MATH138") },
    { itemId: compMathItems[0].id, courseId: findCourse("CS115") },

    // Computational options
    { itemId: compMathItems[1].id, courseId: findCourse("AMATH242") },
    { itemId: compMathItems[1].id, courseId: findCourse("CS371") },

    // Advanced options
    { itemId: compMathItems[2].id, courseId: findCourse("AMATH331") },
    { itemId: compMathItems[2].id, courseId: findCourse("AMATH342") },
  ]);

  // Link courses to C&O requirements
  await db.insert(templateRequirementCourses).values([
    // Core math courses
    { itemId: coItems[0].id, courseId: findCourse("MATH137") },
    { itemId: coItems[0].id, courseId: findCourse("MATH138") },
    { itemId: coItems[0].id, courseId: findCourse("MATH239") },

    // Combinatorics options
    { itemId: coItems[1].id, courseId: findCourse("CO342") },
    { itemId: coItems[1].id, courseId: findCourse("MATH239") },

    // Optimization options
    { itemId: coItems[2].id, courseId: findCourse("CO250") },
    { itemId: coItems[2].id, courseId: findCourse("CO351") },
  ]);

  console.log("Database seeded successfully!");
}

main().catch((err) => {
  console.error("Failed to seed database:", err);
  process.exit(1);
});
