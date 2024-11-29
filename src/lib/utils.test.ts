import { normalizeCourseCode, generateTerms } from "./utils";

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