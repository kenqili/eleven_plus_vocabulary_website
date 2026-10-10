/**
 * The front page: what this is, what it does, and how to start.
 *
 * Written to be read by a parent deciding whether to spend money, which shapes
 * almost every choice in it. They are not the child and they are not a teacher:
 * they are somebody's mum or dad with an 11+ somewhere between one and three years
 * away, a long list of things to sort out, and no vocabulary of their own to judge
 * this with. So it leads with the problem they recognise, answers the questions they
 * actually ask in the order they ask them, and says plainly what this does not do.
 *
 * That last part is not politeness. `about` already carries the hardship message and
 * the facts; repeating it here is what stops this page reading as marketing, and a
 * parent who finds out on their own that the app does not do maths is a parent who
 * does not come back.
 *
 * A server component, and that is what makes the numbers trustworthy. Both figures
 * arrive as props from `app/page.tsx`, which reads them from the word bank. The
 * first draft fetched them on the client and was wrong twice over — from an
 * endpoint whose `words` is the free-tier question list, and then from one that
 * needs a session, so a signed-out visitor — which is nearly all of them — saw no
 * number at all. A number rendered from the bank cannot drift from the product and
 * cannot be missing for the people who most need to read it.
 */
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Printer,
  ListChecks,
  CalendarDays,
  HeartHandshake,
  Sparkles,
} from "lucide-react";
import Header from "./header";

/**
 * What the app covers, said to a parent.
 *
 * The count is a prop from the server rather than written here, because a number on
 * a sales page that disagrees with the app is worse than no number.
 *
 * There used to be a second constant here naming four publications the words were
 * said to come from, with a count for each. Every figure was right about the source
 * files and the claim was wrong about the site: the words are collected by the
 * family who runs this and by their two sons preparing for their own 11+, together
 * with UK education sites and free resources. Naming third-party lists implied a
 * licence and a curation this does not have.
 */
/**
 * The six levels, named the way the app names them, with a real word from each.
 *
 * The examples are taken from the bank's own difficulty column and
 * `tests/landing-page.test.mjs` asserts every one of them sits at the level claimed
 * here. That test exists because the first draft of this list was written from
 * memory and had four of the six in the wrong band and one word — sesquipedalian —
 * that is not in the product at all. A parent who types an example into the app and
 * gets nothing has been told a lie by a page whose entire value is that it can be
 * checked.
 *
 * The level names are the app's own `DIFFICULTY_SHORT`, so a parent who reads
 * "Literary" here and sees it in the app is not being sold something else.
 */
const LEVELS = [
  // Level 0's example used to be `accommodate`. That is genuinely level 0 and
  // genuinely in the bank — but it is the first word a parent reads under the
  // label "Everyday", and it does not read as everyday to anybody who is not
  // already a teacher. Every parent does a small double-take, and a first
  // impression is a bad place to look like the levels are mislabelled.
  //
  // `vegetable` is level 0 too, and is plainly what the label claims. The band
  // is the curriculum-extension set rather than a frequency band — see
  // `data/word-levels/levels.json` — so it holds both plain words and ones like
  // `alliteration`, and picking from it is a judgement about which member to
  // show. `tests/landing-page.test.mjs` still checks the level, so this cannot
  // quietly become a word from the wrong band.
  { name: "Everyday", example: "vegetable" },
  { name: "Common", example: "abandon" },
  { name: "Less common", example: "abundance" },
  { name: "Uncommon", example: "antiquity" },
  { name: "Literary", example: "affable" },
  { name: "Rare", example: "assiduous" },
] as const;

/** How many question types there are, so the list below cannot overstate. */
const QUESTION_TYPES = [
  {
    name: "What does this word mean?",
    detail: "the definition, from four options",
  },
  { name: "Which word means this?", detail: "the word, from four options" },
  {
    name: "Which word is nearly the opposite?",
    detail: "antonyms, from four options",
  },
  {
    name: "Which word is nearly the same?",
    detail: "synonyms, from four options",
  },
  { name: "Fill in the gap", detail: "the word, in a sentence they can read" },
] as const;

/**
 * How many words a child keeps when nothing has been bought.
 *
 * The same number `FREE_WORD_LIMIT` sets for the app, and it is stated in the hero
 * rather than left to the account page. A parent told the drop in advance feels
 * informed; the same parent who finds it on day eight feels sold to. It is 224
 * rather than a round number because that is what the app actually does.
 */
/**
 * What a family gets that the app does not obviously have.
 *
 * Four facts a parent asks for and which are all true, so they are said rather than
 * left to be discovered. One account is one child is the one that surprises people:
 * a family with two children pays twice, and finding that out after buying is worse
 * than being told before.
 */
const FACTS = [
  {
    title: "Nothing to install",
    body: "It is a website. Open it on a laptop, a tablet or a phone and it works — there is no app to download and nothing to update.",
  },
  {
    title: "About twenty questions per round",
    body: "Short enough that a tired child will finish it. Many families do one a day, and stopping for a week loses nothing.",
  },
  {
    title: "One account is one child",
    body: "Progress is kept per account, so a second child needs a second account. There is no family plan and we would rather say so than let you find out later.",
  },
  {
    title: "Add the words from your own book",
    body: "Up to 500 of your own words, alongside the built-in ones. If you have a book open on the sofa, you can practise from that too.",
  },
] as const;

/**
 * @param totalWords  Every word in the bank, from the word bank itself.
 * @param freeWords   What a child keeps when nothing has been bought.
 * @param storyCount  How many stories there are, counted rather than guessed.
 * @param priced      What a membership costs, read from Stripe. Empty when it
 *                    cannot be read, and the page then says what it always said.
 */
export default function Landing({
  totalWords,
  freeWords,
  storyCount,
  priced,
}: {
  totalWords: number;
  freeWords: number;
  storyCount: number;
  priced: {
    tier: string;
    label: string;
    formatted: string | null;
    recurring: boolean;
  }[];
}) {
  const words = totalWords.toLocaleString("en-GB");
  const stories = storyCount.toLocaleString("en-GB");
  /*
   * Only prices that have an amount, and all of them or none.
   *
   * `publicPrices()` returns one entry per tier with `formatted: null` when it
   * could not read that one. Rendering the list on `priced.length > 0` — which is
   * what this did first — produced "for 1 month / for 3 months / for 1 year" with
   * no amounts in front of any of them, when Stripe was unreachable. A shelf of
   * three terms and no prices is worse than the sentence it replaced: the reader
   * is told there is a cost, and then not what it is.
   *
   * So a price without an amount is not shown at all, and a partial list is not
   * shown either. One unknown tier drops the section back to the wording that
   * does not need the numbers, which is honest and complete.
   */
  const shownPrices =
    priced.length > 0 && priced.every((price) => price.formatted) ? priced : [];

  return (
    <>
      <Header />
      <main className="workspace">
        <section className="landing-hero">
          <p className="landing-kicker">
            11+ English and verbal reasoning · for Years 4 to 6 preparing for
            the entrance test
          </p>
          <h1>11+ words to practise, level by level, until you know them.</h1>
          <p className="landing-lede">
            {words} words, from everyday to rare, tested five ways, with many
            met again in short stories. About 20 questions per round, and words
            your child misses come back for extra practice.
          </p>
          <div className="landing-actions">
            <Link className="primary-button" href="/practice">
              Try free practice <ArrowRight size={17} />
            </Link>
            <Link className="text-button" href="/account">
              Create a free account
            </Link>
          </div>
          <p className="landing-fine">
            Free for 7 days with every word, no card needed. After the trial
            your child keeps the {freeWords} easiest words; the rest, and
            printing, need a paid term. Nothing is deleted when the trial ends.
          </p>
          {/*
            Who it is for, with names. Five parent reviewers from British,
            Russian, Indian and Chinese backgrounds all asked the same question:
            is this pitched at my exam — a highly selective grammar, a Kent
            grammar, an independent? Naming example schools answers it in one
            line, and it is the honest kind of SEO: parents search for their
            school plus "vocabulary".

            Two rules keep it honest, both asserted by `tests/landing-page.test.mjs`.
            "Preparing for" examples only: each school sets its own test and this
            teaches the words behind the papers, not the papers. No exam-board
            names, no endorsement, no syllabus claims — the same rule that bans
            Bond/GL/CEM everywhere else.
          */}
          <p className="landing-fine">
            Preparing for a selective school — for example Queen
            Elizabeth&apos;s Barnet, Henrietta Barnett, Tiffin or
            St&nbsp;Olave&apos;s, or an independent such as St&nbsp;Paul&apos;s,
            Westminster, Habs or Merchant Taylors? Each school sets its own
            test. This teaches the vocabulary for the English and verbal
            reasoning papers, not past papers.
          </p>
          {/*
            Worldwide, not just the 11+. The site is built for UK Years 4 to 6
            heading for the entrance test, but the words are ordinary English
            vocabulary and the levels, stories and mistake lists work wherever
            a 9 to 11 year old lives. Said in one paragraph, kept separate from
            the school names so neither audience reads the other's copy as
            theirs — and asserted by `tests/landing-page.test.mjs` alongside
            the UK focus, because one must not quietly displace the other.
          */}
          <p className="landing-fine">
            Not sitting the 11+? The same words suit any child aged 9 to 11
            building their English vocabulary. The levels, the stories and the
            mistake lists work wherever you live — no entrance test required.
          </p>
        </section>

        {/*
          What it is for. A parent has just been told their child needs a wider
          vocabulary and has no idea what that means in practice, so this is the
          plainest statement of it: a word is a hurdle in the exam, and this is the
          list of hurdles.
        */}
        <section className="landing-section">
          <h2>What the 11+ actually asks for</h2>
          <p>
            English and verbal reasoning papers both depend on one thing:
            knowing what words mean, and which words are close in meaning and
            which are opposite. Pick the wrong one out of four and the question
            is lost, however well your child reads the rest of it.
          </p>
          <p>
            So vocabulary is not an extra — it is one of the most important
            parts of the English and verbal reasoning papers. It is not the
            whole score, and this site will not pretend otherwise: no word list
            gives you the exam questions. What it does is stop a child losing
            marks they had already earned by reading well.
          </p>
        </section>

        {/*
          Five question types, because "it tests vocabulary" is not enough for a
          parent to picture. These are the five the app asks, in the words the app
          shows them.
        */}
        <section className="landing-section">
          <h2>Five ways a word gets tested</h2>
          <ul className="landing-list">
            {QUESTION_TYPES.map((type) => (
              <li key={type.name}>
                <strong>{type.name}</strong>
                <span className="muted"> — {type.detail}</span>
              </li>
            ))}
          </ul>
          <p className="muted">
            Four options each, so a child chooses from four answers instead of
            writing their own.
          </p>
        </section>

        {/*
          The word count and where the words came from. A parent is doing a real
          comparison against the book in their hand, and being able to do it is most
          of the trust.

          The last sentence used to read "Every word has a definition, and most have
          synonyms, antonyms and an example sentence." Not wrong, but it buried the
          fact: every word has an example sentence, all 2,247 of them, and only
          synonyms and antonyms are ever missing. Lumping a universal in with a
          near-universal made the site sound patchier than it is, in the one
          sentence a sceptical parent reads most closely.

          The counts below are measured from the word bank by
          `tests/landing-page.test.mjs`, so the sentence cannot drift from the data
          the way a typed-in figure would.
        */}
        <section className="landing-section">
          <h2>Where the words come from</h2>
          <p>
            We built the {words} words by collecting them the way our own sons
            did: writing down every unfamiliar word they met in their reading
            and their practice papers, working through UK education websites and
            free revision resources, and adding the ones that kept coming up.
          </p>
          <p>
            Every one of them has a definition and a real example sentence. All
            but a handful also have synonyms and antonyms, which is what makes
            the nearest-word questions possible.
          </p>
          <p>
            They run from everyday words to rare ones that turn up once in a
            passage, sorted into six levels. There is no official 11+ word list,
            and every school makes a different test — so this teaches many words
            instead of how one school asks its questions.
          </p>
        </section>

        {/*
          Stories. A parent will not expect this and it is arguably the best thing
          here, so it gets a section rather than a card among "also here".

          The section it replaced named four publications and a count for each.
          That was accurate about the source files and wrong about the site: the
          words are collected by the family who runs this and by their two sons
          preparing for their own 11+, together with UK education sites and free
          resources. Naming third-party lists implied a licence and a curation this
          does not have, and a parent who went looking for the book would not find
          a shelf of them.
        */}
        <section className="landing-section">
          <h2>Words are learned by meeting them, not by being told</h2>
          <p>
            A word on a list is a word a child can recognise and not much more.
            A word they have read used, in a story they wanted to finish, is a
            word they are likelier to remember. So we write the vocabulary into
            short stories — written to be funny, because a child who is laughing
            is a child who is reading — and the word turns up in the middle of a
            sentence they have to understand to follow.
          </p>
          <p>
            There are {stories} of them, across all six levels, and they cost
            nothing to read. These are words that keep turning up — in the exam,
            and in secondary-school reading after it.
          </p>
          <div className="landing-actions">
            <Link className="text-button" href="/stories">
              <BookOpen size={16} /> Read the stories
            </Link>
          </div>
        </section>

        {/*
          Difficulty, because "2,000 words" means nothing on its own — a child who
          knows the easy half has not got far. The six levels are the app's own, so
          the page and the product agree.
        */}
        <section className="landing-section">
          <h2>From everyday to rare</h2>
          <p>
            Sorted into six levels, so a child starts where they are and moves
            up step by step instead of all at once. A child who has never met a
            rare word is not behind; they are at the beginning, which is where
            Everyday starts.
          </p>
          <ol className="landing-levels">
            {LEVELS.map((level) => (
              <li key={level.name}>
                <span className="landing-level-name">{level.name}</span>
                <span className="landing-level-word muted">
                  {level.example}
                </span>
              </li>
            ))}
          </ol>
          <p className="muted">
            Practise one level, or choose exactly which words to work on — you
            are not limited to the level the app thinks they are at. The higher
            levels are there for children aiming at highly selective schools.
          </p>
        </section>

        {/*
          Print. This is the part that gets a parent to buy, and it has to be said
          plainly: the words are theirs to print, with no paywall and no watermark.
          A family who cannot afford every book still gets the vocabulary, and a
          family who can print exactly what they need does not have to.
        */}
        <section className="landing-section">
          <h2>Free to print while your trial or membership lasts</h2>
          <p>
            Any of the {words} words can be printed as a clean sheet — word
            only, word and meaning, or word with a sentence — laid out to fit
            the page, from a handful of words to the whole list.
          </p>
          <p>
            And you can print exactly the words your child gets wrong. The app
            remembers which ones they answer wrong, and the print page shows
            only those words. It turns a weak subject into a short list.
          </p>
          <div className="landing-actions">
            <Link className="text-button" href="/words/print">
              <Printer size={16} /> Printable word sheets
            </Link>
            <Link className="text-button" href="/words">
              <ListChecks size={16} /> Word list and progress
            </Link>
            <Link
              className="text-button"
              href="/free-11-plus-vocabulary-words"
            >
              <ListChecks size={16} /> Free 100-word starter list
            </Link>
          </div>
          <p className="landing-fine">
            Printing is free while your trial or membership is active, including
            the 7-day trial. After a free trial ends it needs a paid term — we
            would rather your child learned the words than bought anything from
            us, but we do have hosting to pay for.
          </p>
        </section>

        {/*
          What it does not do. Said early and plainly, because a parent who finds
          this out later feels misled even when it was never claimed. Maths and
          non-verbal reasoning are a different subject with different practice, and
          pretending otherwise would be the cheapest lie on the page.
        */}
        <section className="landing-section landing-scope">
          <h2>What this does not cover</h2>
          <p>
            Vocabulary, and the English and verbal reasoning that depends on it.
            <strong> Maths and non-verbal reasoning are not covered</strong> —
            they need different practice, and a vocabulary app that pretended
            otherwise would waste your time as well as your money.
          </p>
          <p className="muted">
            There are plenty of good resources for those. This one does the
            words.
          </p>
        </section>

        {/*
          Other things that exist, briefly. A parent who has not seen them will not
            ask, so this is not trying to sell them.
        */}
        <section className="landing-section">
          <h2>Also here</h2>
          <div className="landing-grid">
            <article className="landing-card">
              <CalendarDays size={20} />
              <h3>Practice calendar</h3>
              <p className="muted">
                How much your child has practised each day, how long for, and
                how many words they have mastered since the start.
              </p>
            </article>
            <article className="landing-card">
              <BookOpen size={20} />
              <h3>Stories</h3>
              <p className="muted">
                Short stories with the vocabulary in them, free to read, so a
                new word is met in a sentence rather than on its own.
              </p>
            </article>
            <article className="landing-card">
              <Sparkles size={20} />
              <h3>Badges for words mastered</h3>
              <p className="muted">
                Earned by getting answers right, so a child who has done enough
                can spend them on a badge. Nothing is lost by stopping for a
                week.
              </p>
            </article>
          </div>
        </section>

        {/*
          Cost, said before the parent has to go and look for it. A price found by
          searching is a price that stops people buying; the number that matters is
          the whole-term one, and "no subscription" is the sentence that makes the
          rest of it believable.
        */}
        <section className="landing-section">
          <h2>What it costs</h2>
          {/*
            The prices, read from Stripe and rendered on the server.

            This used to say "at a price shown before you pay anything" and send the
            reader to the account page to find out — on the one section whose job is
            to answer "how much". A parent who has to sign in to learn the price has
            been asked for a commitment before being told the cost, which is the
            thing that stops people buying.

            The amounts come from `publicPrices()` rather than being written here,
            because the real price lives in Stripe and a second copy of it in the
            copy is a number that can disagree with what the card is charged. The
            same class of bug as the word count.

            And when they cannot be read the section says what it always said. A
            Stripe outage must not blank the price or, worse, fail the front page:
            `publicPrices()` returns `amount: null` per tier and never throws, so
            this falls back to the old wording with no error and no missing figure.
          */}
          {shownPrices.length > 0 ? (
            <>
              <p>
                Seven days free, with no card needed. After that a fixed length,
                bought once:
              </p>
              <ul className="landing-prices">
                {shownPrices.map((price) => (
                  <li key={price.tier}>
                    <strong>{price.formatted}</strong>
                    <span className="muted">
                      {" "}
                      for {price.label}
                      {price.recurring
                        ? " — this one renews, which we do not otherwise use"
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <p>
                It is a one-off payment: it does not renew, there is nothing to
                cancel, and we will not charge you again. Buying again just adds
                time. One account is one child, so two children need to pay
                twice.
              </p>
            </>
          ) : (
            <>
              <p>
                Seven days free, with no card needed. After that a fixed length
                — a month, three months or a year — at a price shown before you
                pay anything. It is a one-off payment: it does not renew, there
                is nothing to cancel, and we will not charge you again.
              </p>
              <p className="muted">
                Prices are on the <Link href="/account">account page</Link>, and
                buying again adds to the time your child has rather than
                replacing it.
              </p>
            </>
          )}
        </section>

        {/*
          Money. Asked by somebody who has already read everything above and still
            cannot pay, so it gets its own section rather than a footnote, and it is
          not embarrassed.
        */}
        <section className="landing-section landing-help">
          <HeartHandshake size={24} />
          <h2>If money is the problem, it should not stand in the way</h2>
          {/*
            Three paragraphs here said three different things about proof, and a
            parent who is genuinely struggling is exactly the person who notices.

            It used to ask for proof of free school meals, then two sentences later
            promise "no means test form, nothing that puts you in a position where
            you have to prove you are struggling" — and the coupon paragraph at the
            bottom added a third version. Asking and then promising not to ask is
            worse than either alone, because it teaches the reader to distrust the
            promise.

            So: nothing is required, and proof is offered only as something that
            helps if it happens to be to hand. That is what /about already says and
            it is what /privacy already describes — the evidence is read once and
            deleted. Asserted across all three files by `tests/landing-page.test.mjs`,
            because the failure is internal disagreement between pages.
          */}
          <p>
            Every child is entitled to learn, and a fee should not decide
            whether yours does. If it is difficult, email us and say so — that
            is the whole process. No form, no means test, no interview, and
            nothing that asks you to account for your finances to a stranger.
          </p>
          <p>
            You do not need to send any evidence. If you happen to have proof
            that your child qualifies for free school meals or another
            government low-income scheme and it is already in your inbox,
            sending it will simply speed things up. Either way you get an
            answer.
          </p>
          <p>
            Write to{" "}
            <a href="mailto:support@11pluswords.com">support@11pluswords.com</a>
            .
          </p>
        </section>

        {/*
          Four plain facts. Each is something a parent has asked this site and had to
          dig for, and each is true — which is the point. A landing page that
          answered its reader's actual questions is more persuasive than one that
          only reassures them.
        */}
        <section className="landing-section">
          <h2>Things worth knowing first</h2>
          <div className="landing-grid">
            {FACTS.map((fact) => (
              <article className="landing-card" key={fact.title}>
                <h3>{fact.title}</h3>
                <p className="muted">{fact.body}</p>
              </article>
            ))}
          </div>
          <p className="muted">
            If the cost is a problem, ask. We issue codes to families who are
            finding it hard, so you can keep every word and keep printing
            without paying. No proof needed — one email and a code appears on
            your account page.
          </p>
        </section>

        <section className="landing-cta">
          <h2>Worth a try before you spend anything</h2>
          <p>
            Seven days, all of it, no card. If it does not help, nothing has
            been lost but an afternoon.
          </p>
          <div className="landing-actions">
            <Link className="primary-button" href="/practice">
              Try free practice <ArrowRight size={17} />
            </Link>
            <Link className="text-button" href="/account">
              Create a free account
            </Link>
          </div>
          <p className="landing-fine">
            Not sure yet? <Link href="/how-to">How to use this</Link> ·{" "}
            <Link href="/info">The 11+ explained</Link> ·{" "}
            <Link href="/about">About MineWords</Link>
          </p>
        </section>

        {/*
          A footer, because every other page has one and this is the page where a
          parent decides whether to hand over card details. It carries the privacy
          notice and the contact address, and the address is the one thing on this
          page a parent may want before paying rather than after.
        */}
        <footer className="site-footer">
          <span>Small steps, kept going.</span>
          <span>
            <Link href="/privacy">What we store, and how to delete it</Link> ·{" "}
            <a href="mailto:support@11pluswords.com">support@11pluswords.com</a>
          </span>
        </footer>
      </main>
    </>
  );
}
