import { useMutation, useQueryClient } from "@tanstack/react-query";
import { planQuery } from "./planning";

export function usePlanningMutation(scope?: string) {
  const client = useQueryClient();
  return useMutation({
    scope: scope ? { id: scope } : undefined,
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: planQuery.queryKey }),
        client.invalidateQueries({
          predicate: (query) =>
            String(query.queryKey[0]).startsWith("/api/v1/schedules"),
        }),
      ]);
    },
  });
}
