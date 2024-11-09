# What this app is about

This app is a web application that helps students plan their academic journey. It allows students to create an academic plan based on predefined templates.

Students can select courses in a plan (using a checkbox).

Students can then schedule their selected courses across different terms (e.g., Fall 2023, Winter 2024, etc.).

# Entities

Our app is composed of the following entities:

1. User: A person who uses the app. A user has an email.
2. Plan: A user's academic plan. Each user has exactly one plan.
3. Template: Predefined academic plans, e.g. Computational Mathematics Major. A template has a name and a description.
4. Template Items: Items that make up a template, it can be one of the following: Requirement, Instruction, Separator. Template items have their order stored.
5. Requirement: A requirement that a user must fulfill. The requirement description provides guidelines for course selection (e.g., "complete 3 of the 5 courses listed"), but these are not enforced by the system.
6. Instruction: Instructions that is used to guide the user.
7. Separator: A separator that is used to separate groups of requirements.
8. Course: A course that a user can take. A course has a course code, name, and various ratings (useful, liked, easy, general) which are pre-populated from external sources.
9. Schedule: A schedule that a user can create. A schedule consists of a name and course-term assignments. Each course can only appear once in a schedule.

# Relationships

1. A user has exactly one plan. So 1:1 relationship between User and Plan.
2. A plan is made up of several templates. Templates can also be in multiple plans. So M:N relationship between Plan and Template.
3. A template is made up of several template items. So 1:M relationship between Template and Template Items.
4. A template item can be one of the following: Requirement, Instruction, Separator. So 1:1 relationship between Template Items and Requirement/Instruction/Separator.
5. A requirement can have several courses, and a course can be in several requirements. So M:N relationship between Requirement and Course.
6. A user can take several courses, and a course can be taken by several users. So M:N relationship between User and Course.
7. A user can create several schedules for their plan. So 1:M relationship between Plan and Schedule.
8. A schedule consists of several courses with their assigned terms. A course can appear in multiple schedules but only once per schedule. So M:N relationship between Schedule and Course, with term as an attribute of the relationship.
