export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  attributes?: Record<string, string | number | boolean>,
): void;
export function injectTraceHeaders(
  headers: Record<string, string>,
  request: Request,
): void;
