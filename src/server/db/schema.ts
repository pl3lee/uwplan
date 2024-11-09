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
} from "drizzle-orm/pg-core";
import { type AdapterAccount } from "next-auth/adapters";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator((name) => `${name}`); // Remove prefix

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
  plans: many(plans),
  templates: many(userTemplates),
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

// Enum for item types
export const itemTypeEnum = pgEnum("item_type", ["requirement", "instruction", "separator"]);

// Course table
export const courses = createTable("course", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 10 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  rating: integer("rating"),
  difficulty: integer("difficulty"),
  workload: integer("workload"),
});

// Academic Plan table
export const plans = createTable("plan", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  templateId: integer("template_id")
    .notNull()
    .references(() => templates.id),
}, (plan) => ({
  userIdIdx: index("plan_user_id_idx").on(plan.userId),
  templateIdIdx: index("plan_template_id_idx").on(plan.templateId),
}));

// Items table
export const items = createTable("item", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => plans.id),
  type: itemTypeEnum("type").notNull(),
  description: text("description"),
  orderIndex: integer("order_index").notNull(),
}, (item) => ({
  planIdIdx: index("item_plan_id_idx").on(item.planId),
}));

// Course selections for requirements
export const requirementCourses = createTable("requirement_course", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => items.id),
  courseId: integer("course_id").notNull().references(() => courses.id),
}, (rc) => ({
  itemIdIdx: index("requirement_course_item_id_idx").on(rc.itemId),
  courseIdIdx: index("requirement_course_course_id_idx").on(rc.courseId),
}));

// User's course selections
export const userPlanCourses = createTable("user_plan_course", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  planId: integer("plan_id").references(() => plans.id), // Remove notNull
  courseId: integer("course_id").notNull().references(() => courses.id),
  take: boolean("take").notNull().default(false),
}, (upc) => ({
  userIdIdx: index("user_plan_course_user_id_idx").on(upc.userId),
  planIdIdx: index("user_plan_course_plan_id_idx").on(upc.planId),
  courseIdIdx: index("user_plan_course_course_id_idx").on(upc.courseId),
  // Add unique constraint for userId + courseId
  uniqUserCourse: uniqueIndex("user_plan_course_user_course_idx").on(upc.userId, upc.courseId),
}));

// User's template selections
export const userTemplates = createTable("user_template", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  templateId: integer("template_id")
    .notNull()
    .references(() => templates.id),
}, (ut) => ({
  userIdIdx: index("user_template_user_id_idx").on(ut.userId),
  templateIdIdx: index("user_template_template_id_idx").on(ut.templateId),
  // Ensure users can't select the same template twice
  uniqUserTemplate: uniqueIndex("user_template_user_template_idx").on(ut.userId, ut.templateId),
}));

// Template table - predefined academic plans
export const templates = createTable("template", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
});

// Template items table - requirements/instructions/separators for templates
export const templateItems = createTable("template_item", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").notNull().references(() => templates.id),
  type: itemTypeEnum("type").notNull(),
  description: text("description"),
  orderIndex: integer("order_index").notNull(),
}, (item) => ({
  templateIdIdx: index("template_item_template_id_idx").on(item.templateId),
}));

// Template courses table - courses for template requirements
export const templateRequirementCourses = createTable("template_requirement_course", {
  id: serial("id").primaryKey(),
  itemId: integer("item_id").notNull().references(() => templateItems.id),
  courseId: integer("course_id").notNull().references(() => courses.id),
}, (trc) => ({
  itemIdIdx: index("template_requirement_course_item_id_idx").on(trc.itemId),
  courseIdIdx: index("template_requirement_course_course_id_idx").on(trc.courseId),
}));

// Relations (keeping the same relations with updated table references)
export const itemsRelations = relations(items, ({ one, many }) => ({
  plan: one(plans, {
    fields: [items.planId],
    references: [plans.id],
  }),
  courses: many(requirementCourses),
}));

export const requirementCoursesRelations = relations(requirementCourses, ({ one }) => ({
  item: one(items, {
    fields: [requirementCourses.itemId],
    references: [items.id],
  }),
  course: one(courses, {
    fields: [requirementCourses.courseId],
    references: [courses.id],
  }),
}));

export const userPlanCoursesRelations = relations(userPlanCourses, ({ one }) => ({
  plan: one(plans, {
    fields: [userPlanCourses.planId],
    references: [plans.id],
  }),
  course: one(courses, {
    fields: [userPlanCourses.courseId],
    references: [courses.id],
  }),
}));

export const templatesRelations = relations(templates, ({ many }) => ({
  items: many(templateItems),
  users: many(userTemplates),
}));

export const templateItemsRelations = relations(templateItems, ({ one, many }) => ({
  template: one(templates, {
    fields: [templateItems.templateId],
    references: [templates.id],
  }),
  courses: many(templateRequirementCourses),
}));

export const templateRequirementCoursesRelations = relations(templateRequirementCourses, ({ one }) => ({
  item: one(templateItems, {
    fields: [templateRequirementCourses.itemId],
    references: [templateItems.id],
  }),
  course: one(courses, {
    fields: [templateRequirementCourses.courseId],
    references: [courses.id],
  }),
}));

export const plansRelations = relations(plans, ({ one }) => ({
  user: one(users, {
    fields: [plans.userId],
    references: [users.id],
  }),
  template: one(templates, {
    fields: [plans.templateId],
    references: [templates.id],
  }),
}));

export const userTemplatesRelations = relations(userTemplates, ({ one }) => ({
  user: one(users, {
    fields: [userTemplates.userId],
    references: [users.id],
  }),
  template: one(templates, {
    fields: [userTemplates.templateId],
    references: [templates.id],
  }),
}));
