import { normalizeCourseCode } from "./utils";

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