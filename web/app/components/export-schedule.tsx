import { useMutation } from "@tanstack/react-query";
import { exportSchedule } from "~/generated/api/client";
import { ApiError } from "~/lib/api-fetch";
import { ApiErrorMessage } from "./api-error";
import { Button } from "./button";

export function ExportSchedule({ id }: { id: string }) {
  const mutation = useMutation({
    mutationFn: async () => {
      const result = await exportSchedule(id);
      if (result.status !== 200) throw new ApiError(result.status, result.data);
      const url = URL.createObjectURL(result.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "schedule.csv";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  });
  return (
    <div>
      <Button
        variant="outline"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Exporting…" : "Export to CSV"}
      </Button>
      <ApiErrorMessage error={mutation.error} />
    </div>
  );
}
