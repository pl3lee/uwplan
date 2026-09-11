export function ApiErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="my-3 text-sm text-destructive">
      Unable to save or load your plan. Please try again.
    </p>
  );
}
