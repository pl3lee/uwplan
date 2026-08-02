const validationIdPattern = /^validation-[a-f0-9-]{36}$/;

export function isValidationId(value: unknown): value is string {
  return typeof value === "string" && validationIdPattern.test(value);
}
