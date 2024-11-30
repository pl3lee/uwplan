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
        description: "Complete all the following:",
        orderIndex: 1,
        courseType: "fixed",
        courses: ["CS230", "CS234"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 2,
        courseType: "fixed",
        courses: ["AMATH242", "CS371"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following:",
        orderIndex: 3,
        courseType: "fixed",
        courses: ["MATH239", "MATH249"]
      },
      {
        type: "requirement",
        description: "Complete 3 non-math courses, at least one of which is at the 200-, 300-, or 400-level, all from the same subject code, from the following choices: AE, BIOL, BME, CHE, CHEM, CIVE, EARTH, ECE, ECON, ENVE, GEOE, ME, MNS, MSE, MTE, NE, PHYS, SYDE",
        orderIndex: 4,
        courseType: "free",
        courses: [],
        courseCount: 3
      },
      {
        type: "separator",
        orderIndex: 5,
      },
      {
        type: "instruction",
        description: "List 1: Complete 2 of the following",
        orderIndex: 6
      },
      {
        type: "requirement",
        description: "Complete 1 of the following",
        orderIndex: 7,
        courseType: "fixed",
        courses: ["AMATH250", "AMATH251", "AMATH350"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following",
        orderIndex: 8,
        courseType: "fixed",
        courses: ["CO250", "CO255"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following",
        orderIndex: 9,
        courseType: "fixed",
        courses: ["CS245", "CS245E", "PMATH330", "PMATH432"]
      },
      {
        type: "requirement",
        description: "Complete 1 of the following",
        orderIndex: 10,
        courseType: "fixed",
        courses: ["CS246", "CS246E"]
      },
      {
        type: "separator",
        orderIndex: 11,
      },
      {
        type: "instruction",
        description: "List 2: Complete all of the following",
        orderIndex: 12
      },
      {
        type: "requirement",
        description: "Complete 2 courses from the following. Note that CO353 and CO367 cannot be chosen together, and STAT340 and STAT341 cannot be chosen together.",
        orderIndex: 13,
        courseType: "fixed",
        courses: ["AMATH342", "CS475", "PMATH370", "CO353", "CO367", "STAT340", "STAT341"]
      },
      {
        type: "separator",
        orderIndex: 14,
      },
      {
        type: "instruction",
        description: "List 3",
        orderIndex: 15
      },
      {
        type: "requirement",
        description: "Choose 4 additional courses. Choices must be in at least two different subject codes (AMATH, CO, CS, PMATH, STAT), and 2 courses must be at the 400-level",
        orderIndex: 16,
        courseType: "fixed",
        courses: ["AMATH342", "AMATH343", "AMATH382", "AMATH383", "AMATH391", "AMATH442", "AMATH455", "AMATH477", "BIOL382", "CO351", "CO353", "CO367", "CO370", "CO372", "CO450", "CO452", "CO454", "CO456", "CO463", "CO466", "CO471", "CO485", "CO487", "CS341", "CS431", "CS451", "CS466", "CS475", "CS476", "CS479", "CS480", "CS482", "CS485", "CS487", "PMATH370", "STAT340", "STAT341", "STAT440", "STAT441", "STAT442", "STAT444"]
      },
    ]
  })
  await createTemplate({
    name: "Computer Science (BMath) - 2024",
    description: "Computer Science (BMath) - 2024",
    items: [
      {
        type: "instruction",
        description: "Complete all of the following",
        orderIndex: 0
      },
      {
        type: "requirement",
        description: "Complete all the following:",
        orderIndex: 1,
        courseType: "fixed",
        courses: ["CS136L", "CS341", "CS350"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 2,
        courseType: "fixed",
        courses: ["AMATH242", "CS370", "CS371"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 3,
        courseType: "fixed",
        courses: ["CS240", "CS240E"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 4,
        courseType: "fixed",
        courses: ["CS241", "CS241E"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 5,
        courseType: "fixed",
        courses: ["CS246", "CS246E"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 6,
        courseType: "fixed",
        courses: ["CS251", "CS251E"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 7,
        courseType: "fixed",
        courses: ["CS360", "CS365"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 8,
        courseType: "fixed",
        courses: ["MATH237", "MATH247"]
      },
      {
        type: "requirement",
        description: "Complete 1 the following:",
        orderIndex: 9,
        courseType: "fixed",
        courses: ["MATH239", "MATH249"]
      },
      {
        type: "requirement",
        description: "Complete 1 Complete 1 additional CS course chosen from CS340-CS398, CS440-CS489:",
        orderIndex: 10,
        courseType: "free",
        courses: [],
        courseCount: 1
      },
      {
        type: "requirement",
        description: "Complete 2 additional CS courses chosen from CS440-CS489.:",
        orderIndex: 11,
        courseType: "free",
        courses: [],
        courseCount: 2
      },
      {
        type: "requirement",
        description: "Complete 3 additional courses from: ACTSC, AMATH, CO, PMATH, STAT. The following courses are excluded: \n 1. Courses with requisites normally excluding Honours Computer Science students. \n 2. Courses cross-listed with a CS course. \n 3. Courses explicitly listed in Computer Science major academic plans as alternative to CS courses. \n 4. Readings and topics courses.",
        orderIndex: 12,
        courseType: "free",
        courses: [],
        courseCount: 3
      },
      {
        type: "requirement",
        description: "Complete 1 additional course from the following",
        orderIndex: 13,
        courseType: "fixed",
        courses: ["CO487", "CS499T", "STAT440"],
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
