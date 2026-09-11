import { redirect } from "react-router";
import { getCurrentUser } from "~/generated/api/client";
import type { UserBody } from "~/generated/api/model";
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

export async function requireUser(request: Request) {
  const user = await currentUser(request);
  if (!user) throw redirect("/signin");
  return user;
}

export async function loadPrivate<T>(
  request: Request,
  load: (user: UserBody) => Promise<T>,
): Promise<T> {
  try {
    return await load(await requireUser(request));
  } catch (error) {
    // A session can expire between the identity check and a later loader read.
    if (error instanceof ApiError && error.status === 401)
      throw redirect("/signin");
    throw error;
  }
}
