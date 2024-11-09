# Entities

We have a user entity. Our app aims to help users plan their degrees.

We also have a template entity. Templates represent a predefined academic plan (for example, Computational Mathematics major). Templates contain a list of template items.

We have a course entity. Courses represent individual courses that can be taken.

We have a requirement entity. Requirements contain a list of courses that must be taken to fulfill the requirement. The requirement also contains a description.

We have an instruction entity. Instructions simply contains a description.

We have a separator entity. Separators are used to separate requirements in a template.

We have a template item entity. Template items can be a requirement, instruction, or separator.

We have a plan entity. Each user can only have one plan. A plan is built from one or more templates. For each course in a template, the user can mark it to denote that they plan to take the course.
