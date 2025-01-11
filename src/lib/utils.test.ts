import { normalizeCourseCode, generateTerms, validateCreateTemplateFormCourseCodes, getTemplateFormItemTitle, transformTemplateFormData } from "./utils";

describe("normalizeCourseCode", () => {
  it('should remove spaces', () => {
    const course = "cO 250"
    const normalized = normalizeCourseCode(course)
    const expected = "CO250"
    expect(normalized).toBe(expected)
  })

  it('should convert to uppercase', () => {
    const course = "co250"
    const normalized = normalizeCourseCode(course)
    const expected = "CO250"
    expect(normalized).toBe(expected)
  })

  it('should remove spaces and convert to uppercase', () => {
    const course = "CO 250"
    const normalized = normalizeCourseCode(course)
    const expected = "CO250"
    expect(normalized).toBe(expected)
  })

  it('should remove multiple spaces', () => {
    const course = "CO   250"
    const normalized = normalizeCourseCode(course)
    const expected = "CO250"
    expect(normalized).toBe(expected)
  })

  it('should remove spaces at different locations', () => {
    const course = "CO 2 5 0"
    const normalized = normalizeCourseCode(course)
    const expected = "CO250"
    expect(normalized).toBe(expected)
  })
})

describe("generateTerms", () => {
  it("should generate terms in chronological order", () => {
    const terms = generateTerms(
      { season: "Winter", year: 2023 },
      { season: "Fall", year: 2023 }
    );
    expect(terms).toHaveLength(3);
    expect(terms.map(t => t.name)).toEqual([
      "Winter 2023",
      "Spring 2023",
      "Fall 2023"
    ]);
  });

  it("should generate terms across years", () => {
    const terms = generateTerms(
      { season: "Winter", year: 2023 },
      { season: "Spring", year: 2024 }
    );
    expect(terms).toHaveLength(5);
    expect(terms.map(t => t.name)).toEqual([
      "Winter 2023",
      "Spring 2023",
      "Fall 2023",
      "Winter 2024",
      "Spring 2024"
    ]);
  });

  it("should handle single term", () => {
    const terms = generateTerms(
      { season: "Fall", year: 2023 },
      { season: "Fall", year: 2023 }
    );
    expect(terms).toHaveLength(1);
    expect(terms[0]?.name).toBe("Fall 2023");
  });

  it("should handle invalid range by returning empty array", () => {
    const terms = generateTerms(
      { season: "Fall", year: 2023 },
      { season: "Winter", year: 2023 }
    );
    expect(terms).toHaveLength(0);
  });
});

describe('validateCreateTemplateFormCourseCodes', () => {
  const courseOptions = [
    { id: '1', code: 'CS146' },
    { id: '2', code: 'MATH135' },
  ];

  it('should return empty array for valid course codes', () => {
    const items = [
      { type: 'requirement' as const, courseType: 'fixed' as const, description: "" as const, courses: 'CS146, MATH135' },
    ];
    expect(validateCreateTemplateFormCourseCodes(items, courseOptions)).toEqual([]);
  });

  it('should return errors for invalid course codes', () => {
    const items = [
      { type: 'requirement' as const, courseType: 'fixed' as const, description: "" as const, courses: 'CS123, MATH999' },
    ];
    const errors = validateCreateTemplateFormCourseCodes(items, courseOptions);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Invalid codes');
    expect(errors[0]).toContain('CS123, MATH999');
  });

  it('should return empty array for empty items', () => {
    expect(validateCreateTemplateFormCourseCodes([], courseOptions)).toEqual([]);
  });

  it('should ignore non-fixed requirements', () => {
    const items = [
      { type: 'requirement' as const, courseType: 'free' as const, description: "" as const, count: 1 },
      { type: 'separator' as const },
      { type: 'instruction' as const, description: "a" as const },
    ];
    expect(validateCreateTemplateFormCourseCodes(items, courseOptions)).toEqual([]);
  });
});

describe('getTemplateFormItemTitle', () => {
  it('should format separator title', () => {
    const field = { type: 'separator' as const };
    expect(getTemplateFormItemTitle(field, 0)).toBe('Item 1: Separator');
  });

  it('should format instruction title', () => {
    const field = { type: 'instruction' as const, description: "a" as const };
    expect(getTemplateFormItemTitle(field, 1)).toBe('Item 2: Instruction');
  });

  it('should format free requirement title', () => {
    const field = { type: 'requirement' as const, courseType: 'free' as const, description: "a" as const, count: 1 };
    expect(getTemplateFormItemTitle(field, 2)).toBe('Item 3: Free Requirement');
  });

  it('should format fixed requirement title', () => {
    const field = { type: 'requirement' as const, courseType: 'fixed' as const, description: "a" as const, courses: 'CS146' };
    expect(getTemplateFormItemTitle(field, 3)).toBe('Item 4: Fixed Requirement');
  });
});

describe('transformTemplateFormData', () => {
  it('should transform basic template data', () => {
    const formData = {
      name: "Test Template",
      description: "Test Description",
      items: []
    };
    const result = transformTemplateFormData(formData);
    expect(result).toEqual({
      name: "Test Template",
      description: "Test Description",
      items: []
    });
  });

  it('should strip out white space for name', () => {
    const formData = {
      name: "Test Template ",
      description: "Test Description ",
      items: []
    };
    const result = transformTemplateFormData(formData);
    expect(result).toEqual({
      name: "Test Template",
      description: "Test Description ",
      items: []
    });
  });

  it('should transform instruction items', () => {
    const formData = {
      name: "Test",
      description: "",
      items: [{
        type: "instruction" as const,
        description: "Follow these steps"
      }]
    };
    const result = transformTemplateFormData(formData);
    expect(result.items[0]).toEqual({
      type: "instruction",
      description: "Follow these steps",
      orderIndex: 0
    });
  });

  it('should transform separator items', () => {
    const formData = {
      name: "Test",
      description: "",
      items: [{
        type: "separator" as const
      }]
    };
    const result = transformTemplateFormData(formData);
    expect(result.items[0]).toEqual({
      type: "separator",
      orderIndex: 0
    });
  });

  it('should transform fixed requirement items', () => {
    const formData = {
      name: "Test",
      description: "",
      items: [{
        type: "requirement" as const,
        courseType: "fixed" as const,
        description: "Core courses",
        courses: "CS146, MATH135"
      }]
    };
    const result = transformTemplateFormData(formData);
    expect(result.items[0]).toEqual({
      type: "requirement",
      courseType: "fixed",
      description: "Core courses",
      courses: ["CS146", "MATH135"],
      orderIndex: 0
    });
  });

  it('should transform free requirement items', () => {
    const formData = {
      name: "Test",
      description: "",
      items: [{
        type: "requirement" as const,
        courseType: "free" as const,
        description: "Electives",
        count: 3
      }]
    };
    const result = transformTemplateFormData(formData);
    expect(result.items[0]).toEqual({
      type: "requirement",
      courseType: "free",
      description: "Electives",
      courses: [],
      courseCount: 3,
      orderIndex: 0
    });
  });

  it('should transform multiple items with correct order', () => {
    const formData = {
      name: "Test",
      description: "",
      items: [
        {
          type: "instruction" as const,
          description: "Start here"
        },
        {
          type: "requirement" as const,
          courseType: "fixed" as const,
          description: "Required",
          courses: "CS146"
        },
        {
          type: "separator" as const
        }
      ]
    };
    const result = transformTemplateFormData(formData);
    expect(result.items).toHaveLength(3);
    expect(result.items.map(item => item.orderIndex)).toEqual([0, 1, 2]);
    expect(result.items.map(item => item.type)).toEqual([
      "instruction",
      "requirement",
      "separator"
    ]);
  });
});
