import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getListTemplatesQueryKey,
  getListUsersQueryKey,
  listTemplates,
  listUsers,
} from "~/generated/api/client";
import { ApiError, type ApiRequestOptions } from "./api-fetch";

export async function readOwnedTemplates(options?: ApiRequestOptions) {
  const result = await listTemplates({ scope: "mine" }, options);
  if (result.status !== 200) throw new ApiError(result.status, result.data);
  return result.data.templates ?? [];
}
export async function readUsers(options?: ApiRequestOptions) {
  const result = await listUsers(options);
  if (result.status !== 200) throw new ApiError(result.status, result.data);
  return result.data.users ?? [];
}
export const ownedTemplatesQuery = {
  queryKey: getListTemplatesQueryKey({ scope: "mine" }),
  queryFn: () => readOwnedTemplates(),
};
export const usersQuery = {
  queryKey: getListUsersQueryKey(),
  queryFn: () => readUsers(),
};

export function useTemplateMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () =>
      client.invalidateQueries({
        predicate: (query) =>
          ["/api/v1/templates", "/api/v1/plan", "/api/v1/schedules"].some(
            (prefix) => String(query.queryKey[0]).startsWith(prefix),
          ),
      }),
  });
}
