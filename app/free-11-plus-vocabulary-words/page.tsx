import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/minewords/header";
import PrintButton from "@/components/minewords/print-button";
import { words } from "@/lib/challenge/bank";
import levels from "@/data/word-levels/levels.json";
import {
  DIFFICULTY_LEVELS,
  type Difficulty,
} from "@/lib/challenge/difficulty";
import { PAGE_METADATA } from "@/lib/seo";

/**
 * A free starter list: 100 words drawn evenly from all six levels, with
 * plain one-line meanings, printable to paper or PDF.
 *
 * A sample, stated as one: it is the way in, not the collection. The full
 * 2,247 words, the practice that teaches them and the revision sheets stay
 * behind the trial and membership, and nothing here claims these are the
 * words any particular paper will ask.
 */
const QUOTA: Record<Difficulty, number> = {
  0: 10,
  1: 18,
  2: 18,
  3: 18,
  4: 18,
  5: 18,
};

type SampleWord = { word: string; definition: string };

function sampleFor(band: Difficulty): SampleWord[] {
  const levelOf = levels.words as Record<string, { difficulty: number }>;
  const inBand = words
    .filter((word) => levelOf[word.id]?.difficulty === band)
    .sort((a, b) => a.word.localeCompare(b.word, "en"));
  const step = Math.max(1, Math.floor(inBand.length / QUOTA[band]));
  return inBand
    .filter((_, index) => index % step === 0)
    .slice(0, QUOTA[band])
    .map((word) => ({ word: word.word, definition: word.definition }));
}

const SAMPLE = ([0, 1, 2, 3, 4, 5] as const).map((band) => ({
  band,
  name: DIFFICULTY_LEVELS[band],
  words: sampleFor(band),
}));
const TOTAL = SAMPLE.reduce((sum, group) => sum + group.words.length, 0);

export const metadata: Metadata = {
  title: PAGE_METADATA["free-11-plus-vocabulary-words"].title,
  description: PAGE_METADATA["free-11-plus-vocabulary-words"].description,
  alternates: { canonical: "/free-11-plus-vocabulary-words" },
  openGraph: {
    title: PAGE_METADATA["free-11-plus-vocabulary-words"].title,
    description: PAGE_METADATA["free-11-plus-vocabulary-words"].description,
    url: "/free-11-plus-vocabulary-words",
    images: ["/og-image.png"],
  },
};

export default function FreeWordListPage() {
  return (
    <div className="site">
      <Header />
      <main className="workspace words-workspace">
        <div className="page-heading">
          <div>
            <div className="eyebrow">FREE WORD LIST · PRINTABLE</div>
            <h1>100 11+ words to start with.</h1>
            <p className="muted">
              A starter sample drawn from all six levels, with plain meanings.
              Print it, stick it on the fridge, tick words off together — then{" "}
              <Link href="/practice">practise them here</Link>, free for 7
              days.
            </p>
          </div>
          <span className="edition no-print">Free · {TOTAL} words</span>
        </div>
        <div className="landing-actions no-print">
          <PrintButton label="Print or save as PDF" />
          <Link className="text-button" href="/practice">
            Practise these words
          </Link>
        </div>
        {SAMPLE.map((group) => (
          <section
            key={group.band}
            aria-label={`${group.name}, ${group.words.length} words`}
          >
            <h2>
              {group.name} · {group.words.length} words
            </h2>
            <dl className="free-word-list">
              {group.words.map((entry) => (
                <div key={entry.word}>
                  <dt>{entry.word}</dt>
                  <dd>{entry.definition}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section className="landing-section">
          <h2>How to use this list</h2>
          <p>
            Little and often beats everything: five words a day, said aloud and
            used in a sentence each, will do more than an evening spent staring
            at all hundred. When a word sticks, tick it off. When one keeps
            slipping,{" "}
            <Link href="/how-to">read how to practise it here</Link>.
          </p>
          <p className="muted">
            These are ordinary English words grouped by how rarely they turn
            up — there is no official 11+ word list, and every school sets its
            own test. For what the papers actually ask, read{" "}
            <Link href="/info">how the 11+ papers work</Link>.
          </p>
        </section>
        <section className="landing-cta no-print">
          <h2>Ready for the other 2,147?</h2>
          <p>
            Seven days, all of it, no card. The full collection, five ways of
            being tested, and revision sheets of exactly the words yours gets
            wrong.
          </p>
          <div className="landing-actions">
            <Link className="primary-button" href="/practice">
              Try free practice
            </Link>
            <Link className="text-button" href="/account">
              Create a free account
            </Link>
          </div>
        </section>
        <footer className="site-footer">
          <span>Small steps. Lasting knowledge.</span>
          <span>11+ VOCABULARY CHALLENGE</span>
        </footer>
      </main>
    </div>
  );
}
