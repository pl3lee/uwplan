import { ApiError } from "~/lib/api-fetch";
import { ApiErrorMessage } from "./api-error";

export function TemplateError({ error }: { error: unknown }) {
  return error instanceof ApiError && error.status === 409 ? (
    <p role="alert" className="text-sm text-destructive">
      Academic plan name already exists
    </p>
  ) : (
    <ApiErrorMessage error={error} />
  );
}
