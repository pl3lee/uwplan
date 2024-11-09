import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTableCreator,
  primaryKey,
  text,
  timestamp,
  varchar,
  boolean,
  pgEnum,
  serial,
  uniqueIndex,
  decimal,
} from "drizzle-orm/pg-core";
import { type AdapterAccount } from "next-auth/adapters";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `${name}`); // Remove prefix

// NextAuth required tables
export const users = createTable("user", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 255 }).notNull(),
  emailVerified: timestamp("email_verified", {
    mode: "date",
    withTimezone: true,
  }).default(sql`CURRENT_TIMESTAMP`),
  image: varchar("image", { length: 255 }),
});

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
}));

export const accounts = createTable(
  "account",
  {
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id),
    type: varchar("type", { length: 255 })
      .$type<AdapterAccount["type"]>()
      .notNull(),
    provider: varchar("provider", { length: 255 }).notNull(),
    providerAccountId: varchar("provider_account_id", {
      length: 255,
    }).notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: varchar("token_type", { length: 255 }),
    scope: varchar("scope", { length: 255 }),
    id_token: text("id_token"),
    session_state: varchar("session_state", { length: 255 }),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
    userIdIdx: index("account_user_id_idx").on(account.userId),
  })
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessions = createTable(
  "session",
  {
    sessionToken: varchar("session_token", { length: 255 })
      .notNull()
      .primaryKey(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => users.id),
    expires: timestamp("expires", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
  },
  (session) => ({
    userIdIdx: index("session_user_id_idx").on(session.userId),
  })
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const verificationTokens = createTable(
  "verification_token",
  {
    identifier: varchar("identifier", { length: 255 }).notNull(),
    token: varchar("token", { length: 255 }).notNull(),
    expires: timestamp("expires", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
  },
  (vt) => ({
    compoundKey: primaryKey({ columns: [vt.identifier, vt.token] }),
  })
);

// Enum for template item types (requirement, instruction, or separator)
export const itemTypeEnum = pgEnum("item_type", ["requirement", "instruction", "separator"]);

// Enum for course item types (fixed or free)
export const courseItemTypeEnum = pgEnum("course_item_type", ["fixed", "free"]);

// Courses that students can take
// Contains course information and pre-populated ratings from external sources
export const courses = createTable("course", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 10 }).notNull().unique(), // Add unique constraint
  name: varchar("name", { length: 255 }).notNull(),
  usefulRating: decimal("useful_rating", { precision: 4, scale: 3 }),
  likedRating: decimal("liked_rating", { precision: 4, scale: 3 }),
  easyRating: decimal("easy_rating", { precision: 4, scale: 3 }),
  numRatings: integer("num_ratings"), // Changed from generalRating decimal to numRatings integer
});

// Templates represent predefined academic plans (e.g., Computational Mathematics Major)
// Contains basic template information
export const templates = createTable("template", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
});

// Academic plans for users
// Each user has exactly one plan (enforced by unique index on userId)
// Plans are built from one or more templates
export const plans = createTable("plan", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id),
}, (plan) => ({
  userIdIdx: uniqueIndex("plan_user_id_idx").on(plan.userId), // Ensure 1:1 with user
}));

// Items that make up a template
// Can be a requirement, instruction, or separator
// Order is maintained through orderIndex
export const templateItems = createTable("template_item", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => templates.id),
  type: itemTypeEnum("type").notNull(),
  description: text("description"),
  orderIndex: integer("order_index").notNull(),
});

// Each requirement has course items
export const courseItems = createTable("course_item", {
  id: serial("id").primaryKey(),
  requirementId: integer("requirement_id")
    .notNull()
    .references(() => templateItems.id),
  type: courseItemTypeEnum("type").notNull(), // Using the enum type
  courseId: integer("course_id")
    .references(() => courses.id), // Only set for fixed courses
}, (t) => ({
  // Add index for faster lookups
  requirementIdIdx: index("course_item_requirement_id_idx").on(t.requirementId),
}));

// Junction table between plans and templates
// Tracks which templates are used in each plan
export const planTemplates = createTable("plan_template", {
  planId: integer("plan_id").notNull().references(() => plans.id),
  templateId: integer("template_id").notNull().references(() => templates.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.planId, t.templateId] }),
}));

// Schedules created by users to plan when they will take courses
// Each schedule belongs to a plan and has a name
export const schedules = createTable("schedule", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  planId: integer("plan_id").notNull().references(() => plans.id),
});

// Junction table between schedules and courses
// Tracks which courses are scheduled in which terms
// A course can only appear once in a schedule
export const scheduleCourses = createTable("schedule_course", {
  scheduleId: integer("schedule_id").notNull().references(() => schedules.id),
  courseId: integer("course_id").notNull().references(() => courses.id),
  term: varchar("term", { length: 20 }).notNull(), // e.g., "Fall 2023"
}, (t) => ({
  pk: primaryKey({ columns: [t.scheduleId, t.courseId] }),
}));

// Junction table between plans and courses
// Tracks which courses a user has selected in their plan
export const selectedCourses = createTable("selected_course", {
  planId: integer("plan_id").notNull().references(() => plans.id),
  courseId: integer("course_id").notNull().references(() => courses.id),
  selected: boolean("selected").notNull().default(false),
}, (t) => ({
  pk: primaryKey({ columns: [t.planId, t.courseId] }),
}));

// When a user fills in a free course
export const freeCourses = createTable("free_course", {
  id: serial("id").primaryKey(),
  courseItemId: integer("course_item_id")
    .notNull()
    .references(() => courseItems.id),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  filledCourseId: integer("filled_course_id")
    .notNull()
    .references(() => courses.id),
  selected: boolean("selected").default(false),
}, (t) => ({
  // Add unique constraint to ensure one user can only fill a course item once
  uniqueCourseItemUser: uniqueIndex("free_course_item_user_idx").on(t.courseItemId, t.userId),
}));
