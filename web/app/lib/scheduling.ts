import {
  getGetScheduleQueryKey,
  getListSchedulesQueryKey,
  getSchedule,
  listSchedules,
} from "~/generated/api/client";
import { ApiError, type ApiRequestOptions } from "./api-fetch";

export async function readSchedules(options?: ApiRequestOptions) {
  const result = await listSchedules(options);
  if (result.status !== 200) throw new ApiError(result.status, result.data);
  return result.data.schedules ?? [];
}
export async function readSchedule(id: string, options?: ApiRequestOptions) {
  const result = await getSchedule(id, options);
  if (result.status !== 200) throw new ApiError(result.status, result.data);
  return result.data;
}
export const schedulesQuery = {
  queryKey: getListSchedulesQueryKey(),
  queryFn: () => readSchedules(),
};
export const scheduleQuery = (id: string) => ({
  queryKey: getGetScheduleQueryKey(id),
  queryFn: () => readSchedule(id),
});
