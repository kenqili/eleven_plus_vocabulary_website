import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CalendarDays,
  Check,
  CircleHelp,
  Keyboard,
  ListChecks,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import Header from "@/components/minewords/header";

const steps = [
  {
    icon: BookOpenCheck,
    title: "Choose what to practise",
    text: "Start with Definition questions to practise meanings. Add Synonym questions for words with similar meanings and Antonym questions for opposites. Choose one or more types, and change them whenever you like.",
  },
  {
    icon: CircleHelp,
    title: "Have a go, then learn from it",
    text: "Pick the best answer, then read the explanation together. Not sure yet? Choose Skip & reveal to learn the answer. Invite your child to explain the word in their own words or use it in a sentence.",
  },
  {
    icon: RotateCcw,
    title: "Return to words that need practice",
    text: "Missed and revealed words come back for another try, so you don’t need to keep a separate revision list. Each correct answer adds to your child’s progress. Keep sessions short and encouraging.",
  },
];

export default function HowToPage() {
  return (
    <div className="site">
      <Header />
      <main className="workspace howto-workspace">
        <section className="howto-hero">
          <div>
            <div className="eyebrow">A FRIENDLY GUIDE FOR FAMILIES</div>
            <h1>A simple start to daily vocabulary practice.</h1>
            <p>
              Try five minutes together: answer a few questions, talk about a
              tricky word and finish while your child still feels positive.
              Here’s how to get started with MineWords.
            </p>
            <Link className="primary-button" href="/">
              Try free practice <ArrowRight size={17} />
            </Link>
          </div>
          <div className="howto-key-card">
            <Keyboard size={26} />
            <strong>Click, tap or use your keyboard</strong>
            <span>Choose answers on screen, or try these shortcuts.</span>
            <span>
              <kbd>A</kbd>–<kbd>D</kbd> or <kbd>1</kbd>–<kbd>4</kbd> answer
            </span>
            <span>
              <kbd>Enter</kbd> reveal if unanswered
            </span>
            <span>
              <kbd>Enter</kbd> or <kbd>Space</kbd> next after feedback
            </span>
            <span>
              <kbd>←</kbd> review · <kbd>→</kbd> next
            </span>
          </div>
        </section>

        <section className="howto-section">
          <div className="eyebrow">THE DAILY PRACTICE LOOP</div>
          <h2>Try, check, remember.</h2>
          <div className="howto-steps">
            {steps.map(({ icon: Icon, title, text }, index) => (
              <article className="howto-step" key={title}>
                <div className="howto-step-icon">
                  <Icon size={22} />
                </div>
                <span className="howto-step-number">STEP {index + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="howto-section howto-algorithm">
          <div className="howto-algorithm-heading">
            <span className="howto-feature-icon">
              <Sparkles size={22} />
            </span>
            <div>
              <div className="eyebrow">PRACTICE WITH A PURPOSE</div>
              <h2>Tricky words get another chance.</h2>
            </div>
          </div>
          <p>
            MineWords keeps track of practice and brings missed words back, so
            you can spend more time discussing meanings and less time deciding
            what to revise next.
          </p>
          <ul className="howto-rule-list">
            <li>
              <Check size={18} />{" "}
              <span>
                <strong>Explore more of the collection.</strong> Practice
                favours words seen fewer times and avoids recent repeats where
                possible, giving your child a wider range to work on.
              </span>
            </li>
            <li>
              <Check size={18} />{" "}
              <span>
                <strong>Mistakes lead to another try.</strong> Missed and
                revealed words return after other questions, giving your child a
                chance to recall what they have learned.
              </span>
            </li>
            <li>
              <Check size={18} />{" "}
              <span>
                <strong>Meet words in different ways.</strong> When you select
                more than one question type, MineWords favours the type your
                child has practised least for that word.
              </span>
            </li>
            <li>
              <Check size={18} />{" "}
              <span>
                <strong>See progress build.</strong> Five correct answers in
                total mark a word as mastered in MineWords. Wrong answers and
                reveals do not add to the five. This is a practice milestone;
                keep exploring those words in reading and conversation too.
              </span>
            </li>
          </ul>
          <p className="howto-note">
            Progress shows vocabulary practice, not exam readiness. The five
            difficulty levels help you browse this collection by estimated word
            rarity and length; they are not official exam grades or a setting
            for the order of practice questions.
          </p>
        </section>

        <section className="howto-tools">
          <article>
            <ListChecks size={22} />
            <h3>Focus your revision</h3>
            <p>
              Open the <Link href="/words">word list</Link> and choose Needs
              practice to find words to revisit together. During a full-access
              trial or with membership, you can export a spreadsheet or print a
              revision sheet for practice away from the screen.
            </p>
          </article>
          <article>
            <CalendarDays size={22} />
            <h3>Make effort visible</h3>
            <p>
              Your <Link href="/calendar">Learning calendar</Link> shows
              practice days, questions and study time, so children can see their
              small daily efforts add up. Use it to celebrate taking part and
              find a routine that works for your family.
            </p>
          </article>
        </section>

        <section className="howto-tip">
          <div className="howto-feature-icon">
            <BookOpenCheck size={22} />
          </div>
          <div>
            <div className="eyebrow">A SIMPLE ROUTINE</div>
            <h2>Practise first. Then return to books and papers.</h2>
            <p>
              After practice, choose one word to talk about or look for in your
              next reading session. Use MineWords alongside books, schoolwork
              and exam papers to give vocabulary a regular place in your wider
              11+ preparation. Short sessions leave room for everything else.
            </p>
          </div>
        </section>

        <section className="howto-access">
          <h2>Try it first. Choose membership when it fits.</h2>
          <p>
            Start with the free collection to see how practice feels. Visit your
            account for the current full-access trial details and membership
            price. During a full-access trial, you can explore the full
            vocabulary collection and try printing or exporting words.
          </p>
          <p>
            Membership keeps the full collection and revision exports available
            after your trial, with practice and progress in one place. If you
            choose not to subscribe, you can continue with the free collection
            and your saved progress stays safe.
          </p>
          <Link className="primary-button" href="/account">
            View trial and membership <ArrowRight size={17} />
          </Link>
        </section>

        <footer className="site-footer">
          <span>Small steps. Lasting knowledge.</span>
          <span>MINEWORDS · LEARNING, WORD BY WORD</span>
        </footer>
      </main>
    </div>
  );
}
