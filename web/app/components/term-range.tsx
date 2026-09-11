import { changeTermRange } from "~/generated/api/client";
import {
  type TermRangeBody,
  TermRangeBodyStartTerm,
} from "~/generated/api/model";
import { usePlanningMutation } from "~/lib/planning-mutation";
import { ApiErrorMessage } from "./api-error";
import { SelectField } from "./select-field";

const seasons = Object.values(TermRangeBodyStartTerm);
// Present the already-validated saved range as term column labels.
export function termLabels(range: TermRangeBody) {
  const start =
    range.start_year * seasons.length + seasons.indexOf(range.start_term);
  const end = range.end_year * seasons.length + seasons.indexOf(range.end_term);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => {
    const term = start + index;
    return `${seasons[term % seasons.length]} ${Math.floor(term / seasons.length)}`;
  });
}

export function TermRangeSelector({
  range,
  year,
}: {
  range: TermRangeBody;
  year: number;
}) {
  const mutation = usePlanningMutation();
  const years = [
    ...new Set([
      ...Array.from({ length: 30 }, (_, index) => year - 15 + index),
      range.start_year,
      range.end_year,
    ]),
  ]
    .sort((a, b) => a - b)
    .map((value) => ({ value: String(value), label: String(value) }));
  const seasonOptions = seasons.map((value) => ({ value, label: value }));
  const change = (next: TermRangeBody) =>
    mutation.mutate(() => changeTermRange(next));
  return (
    <div>
      <div className="flex flex-col items-start gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">From:</span>
          <SelectField
            label="Start season"
            value={range.start_term}
            options={seasonOptions}
            disabled={mutation.isPending}
            onChange={(value) =>
              change({
                ...range,
                start_term: value as TermRangeBody["start_term"],
              })
            }
          />
          <SelectField
            label="Start year"
            value={String(range.start_year)}
            options={years}
            disabled={mutation.isPending}
            onChange={(value) =>
              change({ ...range, start_year: Number(value) })
            }
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">To:</span>
          <SelectField
            label="End season"
            value={range.end_term}
            options={seasonOptions}
            disabled={mutation.isPending}
            onChange={(value) =>
              change({ ...range, end_term: value as TermRangeBody["end_term"] })
            }
          />
          <SelectField
            label="End year"
            value={String(range.end_year)}
            options={years}
            disabled={mutation.isPending}
            onChange={(value) => change({ ...range, end_year: Number(value) })}
          />
        </div>
      </div>
      <ApiErrorMessage error={mutation.error} />
    </div>
  );
}
