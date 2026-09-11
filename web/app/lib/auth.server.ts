import { getCurrentUser } from "~/generated/api/client";
import { serverApiOptions } from "./api.server";
import { ApiError } from "./api-fetch";

export async function currentUser(request: Request) {
  if (
    !/(?:^|;\s*)(?:__Host-)?uwplan_session=[^;]+/.test(
      request.headers.get("Cookie") ?? "",
    )
  )
    return null;
  try {
    const result = await getCurrentUser(serverApiOptions(request));
    if (result.status !== 200) throw new ApiError(result.status, result.data);
    return result.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
