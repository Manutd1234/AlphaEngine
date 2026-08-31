"use client";

/** The original pressed-button strip, controlled by the deep-link router. */

export default function DiffusionViewControl<View extends string>({
  label,
  value,
  views,
  onValueChange,
  className = "seg diff-view-control",
}: {
  label: string;
  value: View;
  views: ReadonlyArray<readonly [View, string]>;
  onValueChange: (next: View) => void;
  /** Kept caller-owned so the section inventory can count one control row. */
  className?: string;
}) {
  return (
    <div className={className} role="group" aria-label={label}>
      {views.map(([name, word]) => (
        <button
          key={name}
          type="button"
          data-view={name}
          aria-label={`${word} view`}
          aria-pressed={value === name}
          onClick={() => onValueChange(name)}
        >
          {word}
        </button>
      ))}
    </div>
  );
}
