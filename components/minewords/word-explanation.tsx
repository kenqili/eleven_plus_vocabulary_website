"use client";
import { storyMeaning } from "@/lib/challenge/story-meanings";
import type { Feedback } from "@/lib/challenge/types";
import { TYPE_LABELS } from "@/lib/challenge/config";

function display(value: string) {
  return !value?.trim() || /^[—–-]$/.test(value.trim())
    ? "Not provided"
    : value;
}

/** Shared by answer feedback and read-only previous-word review. */
export default function WordExplanation({ word }: { word: Feedback }) {
  return (
    <dl className="word-explanation">
      {word.type !== "def" && (
        <div>
          <dt>Correct {TYPE_LABELS[word.type].toLowerCase()}</dt>
          <dd>{word.answer}</dd>
        </div>
      )}
      <div>
        <dt>Meaning</dt>
        <dd>
          {storyMeaning({
            id: word.word.toLowerCase(),
            definition: word.definition,
          })}
        </dd>
      </div>
      <div>
        <dt>Example</dt>
        <dd>{display(word.example)}</dd>
      </div>
      <div>
        <dt>Similar words (synonyms)</dt>
        <dd>{display(word.syn)}</dd>
      </div>
      <div>
        <dt>Opposite words (antonyms)</dt>
        <dd>{display(word.ant)}</dd>
      </div>
    </dl>
  );
}
