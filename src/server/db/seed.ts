import { fetchUWFlowData, insertUWFlowCourses } from "@/scripts/fetchUWFlowCourses";
import { createTemplate } from "./queries";





async function main() {
  // Fetch and populate courses from UWFlow
  console.log("Fetching and inserting UWFlow courses...");
  const courseData = await fetchUWFlowData();
  await insertUWFlowCourses(courseData);

  console.log("Creating templates and requirements...");

  await createTemplate({
    name: "Bachelor of Mathematics Degree - 2024",
    description: "2024 degree requirements for Bachelor of Mathematics",
    items: [
      {
        type: "instruction",
        description: "Complete all of the following",
        orderIndex: 0
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 1,
        courseType: "fixed",
        courses: ["CS115", "CS135", "CS145"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 2,
        courseType: "fixed",
        courses: ["CS116", "CS136", "CS146"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 3,
        courseType: "fixed",
        courses: ["MATH106", "MATH136", "MATH146"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 4,
        courseType: "fixed",
        courses: ["MATH127", "MATH137", "MATH147"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 5,
        courseType: "fixed",
        courses: ["MATH128", "MATH138", "MATH148"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 6,
        courseType: "fixed",
        courses: ["MATH135", "MATH145"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 7,
        courseType: "fixed",
        courses: ["MATH235", "MATH245"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 8,
        courseType: "fixed",
        courses: ["MATH237", "MATH239", "MATH247", "MATH249"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 9,
        courseType: "fixed",
        courses: ["STAT230", "STAT240"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 10,
        courseType: "fixed",
        courses: ["STAT231", "STAT241"]
      },
      {
        type: "separator",
        orderIndex: 11,
      },
      {
        type: "instruction",
        description: "The following List 1 and List 2 describe the Undergraduate Communication Requirement.",
        orderIndex: 12
      },
      {
        type: "instruction",
        description: "List 1",
        orderIndex: 13
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 14,
        courseType: "fixed",
        courses: ["COMMST100", "COMMST223", "EMLS101R", "EMLS102R", "EMLS129R", "ENGL109", "ENGL129R"]
      },
      {
        type: "instruction",
        description: "List 2",
        orderIndex: 15
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 16,
        courseType: "fixed",
        courses: ["COMMST225", "COMMST227", "COMMST228", "EMLS103R", "EMLS104R", "EMLS110R", "ENGL101B", "ENGL108B", "ENGL108D", "ENGL119", "ENGL208B", "ENGL209", "ENGL210E", "ENGL210F", "ENGL378", "MTHEL300"]
      },
      {
        type: "requirement",
        description: "Complete 1 additional course from List 1 or List 2.",
        orderIndex: 17,
        courseType: "fixed",
        courses: ["COMMST100", "COMMST223", "EMLS101R", "EMLS102R", "EMLS129R", "ENGL109", "ENGL129R", "COMMST225", "COMMST227", "COMMST228", "EMLS103R", "EMLS104R", "EMLS110R", "ENGL101B", "ENGL108B", "ENGL108D", "ENGL119", "ENGL208B", "ENGL209", "ENGL210E", "ENGL210F", "ENGL378", "MTHEL300"]
      }

    ]
  })

  await createTemplate({
    name: "Computational Mathematics Major - 2024",
    description: "2024 academic requirements for Computational Mathematics major",
    items: [
      {
        type: "instruction",
        description: "Complete all of the following",
        orderIndex: 0
      },
      {
        type: "requirement",
        description: "Complete all the following courses:",
        orderIndex: 1,
        courseType: "fixed",
        courses: ["CS230", "CS234"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following courses:",
        orderIndex: 2,
        courseType: "fixed",
        courses: ["AMATH242", "CS371"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following courses:",
        orderIndex: 3,
        courseType: "fixed",
        courses: ["MATH237", "MATH247"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following courses:",
        orderIndex: 4,
        courseType: "fixed",
        courses: ["MATH239", "MATH249"]
      },
      {
        type: "requirement",
        description: "Complete 3 non-math courses, at least one of which is at the 200-, 300-, or 400-level, all from the same subject code, from the following choices: AE, BIOL, BME, CHE, CHEM, CIVE, EARTH, ECE, ECON, ENVE, GEOE, ME, MNS, MSE, MTE, NE, PHYS, SYDE",
        orderIndex: 5,
        courseType: "free",
        courses: [],
        courseCount: 3
      },
      {
        type: "separator",
        orderIndex: 6
      },
      {
        type: "instruction",
        description: "List 1: Complete 2 of the following requirements:",
        orderIndex: 7
      },
      {
        type: "requirement",
        description: "Complete 1 of the following courses:",
        orderIndex: 8,
        courseType: "fixed",
        courses: ["AMATH250", "AMATH251", "AMATH350"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following courses:",
        orderIndex: 9,
        courseType: "fixed",
        courses: ["CO250", "CO255"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following courses:",
        orderIndex: 10,
        courseType: "fixed",
        courses: ["CS245", "CS245E", "PMATH330", "PMATH432"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following courses:",
        orderIndex: 11,
        courseType: "fixed",
        courses: ["CS246", "CS246E"]
      },
      {
        type: "separator",
        orderIndex: 12
      },
      {
        type: "instruction",
        description: "List 2: Complete 2 courses total from the following groups:",
        orderIndex: 13
      },
      {
        type: "requirement",
        description: "Choose from these courses:",
        orderIndex: 14,
        courseType: "fixed",
        courses: ["AMATH342", "CS475", "PMATH370"]
      },
      {
        type: "requirement",
        description: "Complete no more than 1 from:",
        orderIndex: 15,
        courseType: "fixed",
        courses: ["CO353", "CO367"]
      },
      {
        type: "requirement",
        description: "Complete no more than 1 from:",
        orderIndex: 16,
        courseType: "fixed",
        courses: ["STAT340", "STAT341"]
      },
      {
        type: "separator",
        orderIndex: 17
      },
      {
        type: "instruction",
        description: "Complete 4 additional courses from List 2 or List 3; choices must be in at least two different subject codes (AMATH, CO, CS, PMATH, STAT), and 2 courses must be at the 400-level",
        orderIndex: 18
      },
      {
        type: "requirement",
        description: "Choose from List 2 courses:",
        orderIndex: 19,
        courseType: "fixed",
        courses: ["AMATH342", "CS475", "PMATH370", "CO353", "CO367", "STAT340", "STAT341"]
      },
      {
        type: "instruction",
        description: "List 3",
        orderIndex: 20
      },
      {
        type: "requirement",
        description: "Choose from List 3 courses:",
        orderIndex: 21,
        courseType: "fixed",
        courses: ["AMATH343", "AMATH382", "AMATH383", "AMATH391", "AMATH442", "AMATH455", "AMATH477",
          "BIOL382", "CO351", "CO370", "CO372", "CO450", "CO452", "CO454", "CO456",
          "CO463", "CO466", "CO471", "CO485", "CO487", "CS341", "CS431", "CS451",
          "CS466", "CS476", "CS479", "CS480", "CS482", "CS485", "CS487", "STAT440",
          "STAT441", "STAT442", "STAT444"]
      }
    ]
  })

  await createTemplate({
    name: "Free Electives - 10 Courses",
    description: "Add courses of your choice to your schedule",
    items: [
      {
        type: "requirement",
        description: "Add any courses that you want to take",
        orderIndex: 0,
        courseType: "free",
        courses: [],
        courseCount: 10
      }
    ]
  });
  await createTemplate({
    name: "Free Electives - 5 Courses",
    description: "Add courses of your choice to your schedule",
    items: [
      {
        type: "requirement",
        description: "Add any courses that you want to take",
        orderIndex: 0,
        courseType: "free",
        courses: [],
        courseCount: 5
      }
    ]
  });
  await createTemplate({
    name: "Free Electives - 15 Courses",
    description: "Add courses of your choice to your schedule",
    items: [
      {
        type: "requirement",
        description: "Add any courses that you want to take",
        orderIndex: 0,
        courseType: "free",
        courses: [],
        courseCount: 15
      }
    ]
  });


  console.log("Database seeded successfully!");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Failed to seed database:", err);
  process.exit(1);
});
