import type { Feedback } from "@/lib/challenge/types";

function display(value: string) {
  return !value?.trim() || /^[—–-]$/.test(value.trim())
    ? "Not provided"
    : value;
}

/** Shared by answer feedback and read-only previous-word review. */
export default function WordExplanation({ word }: { word: Feedback }) {
  return (
    <dl className="word-explanation">
      <div>
        <dt>Definition</dt>
        <dd>{word.definition}</dd>
      </div>
      <div>
        <dt>Example</dt>
        <dd>{display(word.example)}</dd>
      </div>
      <div>
        <dt>Synonyms</dt>
        <dd>{display(word.syn)}</dd>
      </div>
      <div>
        <dt>Antonyms</dt>
        <dd>{display(word.ant)}</dd>
      </div>
    </dl>
  );
}
