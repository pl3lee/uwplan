import {
  getGetPlanStateQueryKey,
  getGetTemplateQueryKey,
  getListCoursesQueryKey,
  getListTemplatesQueryKey,
  getPlanState,
  getTemplate,
  listCourses,
  listTemplates,
} from "~/generated/api/client";
import { ApiError, type ApiRequestOptions } from "./api-fetch";

export async function readPlan(options?: ApiRequestOptions) {
  const result = await getPlanState(options);
  if (result.status !== 200) throw new ApiError(result.status, result.data);
  return result.data;
}
export async function readTemplates(options?: ApiRequestOptions) {
  const result = await listTemplates({ scope: "all" }, options);
  if (result.status !== 200) throw new ApiError(result.status, result.data);
  return result.data.templates ?? [];
}
export async function readCourses(options?: ApiRequestOptions) {
  const result = await listCourses(options);
  if (result.status !== 200) throw new ApiError(result.status, result.data);
  return result.data.courses ?? [];
}
export async function readTemplate(id: string, options?: ApiRequestOptions) {
  const result = await getTemplate(id, options);
  if (result.status !== 200) throw new ApiError(result.status, result.data);
  return result.data;
}

export const planQuery = {
  queryKey: getGetPlanStateQueryKey(),
  queryFn: () => readPlan(),
};
export const templatesQuery = {
  queryKey: getListTemplatesQueryKey({ scope: "all" }),
  queryFn: () => readTemplates(),
};
export const coursesQuery = {
  // Catalog updates are infrequent. Keep it through normal planning sessions;
  // stale data can refresh in the background without blocking navigation.
  staleTime: 5 * 60_000,
  gcTime: 30 * 60_000,
  queryKey: getListCoursesQueryKey(),
  queryFn: () => readCourses(),
};
export const templateQuery = (id: string) => ({
  queryKey: getGetTemplateQueryKey(id),
  queryFn: () => readTemplate(id),
});
