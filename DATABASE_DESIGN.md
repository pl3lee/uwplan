# What UWPlan is about

UWPlan is a web application that helps students plan their academic journey. It allows students to create an academic plan based on predefined templates.

Students can select courses in a plan (using a checkbox) through selected_course relationships.

Students can then schedule their selected courses across different terms (e.g., Fall 2023, Winter 2024, etc.).

Here is the [DB Diagram](https://dbdiagram.io/d/UWPlan-6750da51e9daa85acab30d37). Note that the diagram does not include all the relationships described below.

# Entities

Our app is composed of the following entities:

1. User: A person who uses the app. A user has an email, name, role (user/admin), and optional profile image.
2. Plan: A user's academic plan. Each user has exactly one plan.
3. Template: Predefined academic plans, e.g. Computational Mathematics Major. A template has a name, optional description, and can have a creator (user).
4. Template Items: Items that make up a template, it can be one of the following types: requirement, instruction, separator. Template items have an order_index and optional description.
5. Course Item: A course item represents either a fixed course or a free course choice for a requirement. It links to a template item (requirement) and optionally to a specific course.
6. Course: A course that can be taken. A course has:
   - code (unique, e.g., "MATH 135")
   - name
   - description
   - prereqs, antireqs, and coreqs
   - useful rating (0-1 scale)
   - liked rating (0-1 scale)
   - easy rating (0-1 scale)
   - number of ratings
7. Schedule: A schedule belongs to a plan and has a name. It contains course-term assignments.
8. Free Course: Represents a user's choice for a free course item. Links a course_item to a specific course selection.
9. User Term Range: Defines a user's academic timeline with start/end terms and years.

# Relationships

1. User to Plan: One-to-one relationship enforced by unique index on plan.user_id.
2. Plan to Template: Many-to-many relationship through plan_template table.
3. Template to Template Items: One-to-many relationship (template_item.template_id).
4. Template Items to Course Items: One-to-many relationship (course_item.requirement_id).
5. Course Items to Courses: Optional many-to-one relationship (course_item.course_id).
6. Plan to Selected Courses: One-to-many relationship tracking course selections through selected_course table.
7. Plan to Schedules: One-to-many relationship (schedule.plan_id).
8. Schedule to Courses: Many-to-many relationship through schedule_course table with term attribute.
9. Free Course Relationships:
   - Links to course_item (many-to-one)
   - Links to user (many-to-one)
   - Links to selected course (many-to-one)
10. Template to User: Optional many-to-one relationship for template creation (template.created_by).
11. User to Term Range: One-to-one relationship defining academic timeline.
