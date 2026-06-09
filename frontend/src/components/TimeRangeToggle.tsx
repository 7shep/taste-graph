import type { TimeRange } from "../types/graph";
import { TIME_RANGE_OPTIONS } from "../types/graph";

interface TimeRangeToggleProps {
  value: TimeRange;
  onChange: (value: TimeRange) => void;
}

export default function TimeRangeToggle({
  value,
  onChange,
}: TimeRangeToggleProps) {
  return (
    <div className="tg-control-group">
      <span className="tg-control-label">Range</span>
      {TIME_RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`tg-control-button ${option.value === value ? "is-active" : ""}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
