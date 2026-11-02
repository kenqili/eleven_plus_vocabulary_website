"use client";

/**
 * The review switch shared by the challenge games.
 *
 * Mastered words are left out by default, because a game that keeps asking
 * words the child already knows stops teaching. A child who wants to revisit
 * the familiar words can turn them back on. Changing the switch starts a new
 * match, so it locks once the first answer is in and while a score is saving.
 */
export default function ReviewToggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="review-toggle" title="Changing this starts a new match.">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
      <span>Include mastered words</span>
      <span className="review-toggle-hint">for a relaxed review</span>
    </label>
  );
}
