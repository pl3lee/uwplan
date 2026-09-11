export type ApiRequestOptions = RequestInit & { baseUrl?: string };
export class ApiError<Data = unknown> extends Error {
  constructor(
    public readonly status: number,
    public readonly data: Data,
  ) {
    super(`API request failed (${status})`);
    this.name = "ApiError";
  }
}
export async function apiFetch<T>(
  url: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { baseUrl, ...init } = options;
  const target = baseUrl ? new URL(url, baseUrl).toString() : url;
  const response = await fetch(target, { credentials: "same-origin", ...init });
  const contentType = response.headers.get("Content-Type") ?? "";
  let data: unknown;
  if (![204, 205, 304].includes(response.status)) {
    if (contentType.includes("json")) data = await response.json();
    else if (contentType.includes("text/csv")) data = await response.blob();
    else data = await response.text();
  }
  if (!response.ok) throw new ApiError(response.status, data);
  return { data, status: response.status, headers: response.headers } as T;
}
export type ErrorType<Data> = ApiError<Data>;
export type BodyType<Data> = Data;
