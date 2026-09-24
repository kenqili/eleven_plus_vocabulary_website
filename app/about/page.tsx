import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Brain,
  GraduationCap,
  HeartHandshake,
  ListChecks,
  NotebookPen,
  Repeat2,
  Sparkles,
} from "lucide-react";
import Header from "@/components/minewords/header";

const steps = [
  {
    icon: NotebookPen,
    number: "01",
    title: "Meet useful words",
    description:
      "Build familiarity with vocabulary children meet in reading and 11+ preparation.",
  },
  {
    icon: Brain,
    number: "02",
    title: "Think, then recall",
    description:
      "Answer mixed questions instead of simply reading a definition and hoping it sticks.",
  },
  {
    icon: Repeat2,
    number: "03",
    title: "Return to tricky words",
    description:
      "Words that need more practice come back, while progress helps children see how far they have come.",
  },
];

export default function AboutPage() {
  return (
    <div className="site">
      <Header />
      <main className="workspace about-workspace">
        <section className="about-hero">
          <div className="about-hero-copy">
            <div className="eyebrow">MADE BY A PARENT, FOR FAMILIES</div>
            <h1>Make 11+ vocabulary practice easier to keep up with.</h1>
            <p>
              Help your child practise word meanings, revisit tricky words and
              see their progress in short sessions. Built by a parent during our
              own children’s preparation for UK grammar school entrance exams,
              often called the 11+.
            </p>
            <Link className="primary-button" href="/">
              Try free practice <ArrowRight size={17} />
            </Link>
          </div>
          <div className="about-hero-art" aria-hidden="true">
            <span className="about-sparkle sparkle-one">✦</span>
            <span className="about-sparkle sparkle-two">✧</span>
            <div className="about-book-stack">
              <div className="about-book book-back">READ · NOTICE · LEARN</div>
              <div className="about-book book-front">
                <BookOpen size={31} />
                <strong>
                  One word
                  <br />
                  at a time
                </strong>
                <span>small steps add up</span>
              </div>
            </div>
            <div className="about-word-chip chip-top">curious</div>
            <div className="about-word-chip chip-bottom">remembered ✓</div>
          </div>
        </section>

        <section className="about-story">
          <div className="about-story-heading">
            <span className="about-section-icon">
              <GraduationCap size={23} />
            </span>
            <div className="eyebrow">THE PROBLEM WE RECOGNISED</div>
            <h2>Looking a word up once wasn’t enough.</h2>
          </div>
          <div className="about-story-copy">
            <p>
              MineWords began at our kitchen table. The books and practice
              papers were full of unfamiliar vocabulary. We tried writing new
              words on scraps of paper and drawing them from a box for revision.
              It worked, but it took time to look each word up, write it down
              and keep track of what the children had already practised. It was
              also easy for a useful word to slip by.
            </p>
            <p>
              A quick dictionary or voice-assistant lookup was easier, but the
              meaning often faded by the next practice paper. We wanted a simple
              way to collect words, test them regularly and bring back the ones
              that still felt difficult.
            </p>
          </div>
        </section>

        <section className="about-method">
          <div className="eyebrow">THE WORD-BOX IDEA, MADE EASIER</div>
          <h2>Learn it. Recall it. Meet it again.</h2>
          <p className="about-method-intro">
            Spend less time organising revision. MineWords keeps the word
            collection, practice questions and review together, ready for your
            next short session.
          </p>
          <div className="about-steps">
            {steps.map(({ icon: Icon, number, title, description }) => (
              <article className="about-step" key={number}>
                <div className="about-step-top">
                  <span className="about-step-icon">
                    <Icon size={22} />
                  </span>
                  <span className="about-step-number">{number}</span>
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="about-results">
          <div className="about-results-icon">
            <Sparkles size={25} />
          </div>
          <div>
            <div className="eyebrow">WHY WE BUILT IT</div>
            <h2>A family tool we wanted to share.</h2>
            <p>
              I’m a software developer, so I started building the tool I wished
              we had: an organised collection, quick practice and a reliable way
              to revisit words. Both of our children received offers from UK
              grammar schools. That success came from their hard work across the
              whole preparation journey; MineWords was one helpful part of it,
              not a shortcut or a guarantee.
            </p>
            <p>
              We’re sharing it so other families can spend less time making
              vocabulary lists and more time helping children build lasting
              confidence with words.
            </p>
            <p>
              We used MineWords in our own family for at least two years before
              sharing it publicly. That everyday experience shaped a simple aim:
              make vocabulary practice easier to fit around school, reading and
              family life.
            </p>
          </div>
        </section>

        <section className="about-beyond">
          <div>
            <div className="eyebrow">A SKILL THAT KEEPS GIVING</div>
            <h2>Useful well beyond exam day.</h2>
          </div>
          <p>
            A stronger vocabulary helps children understand what they read,
            express ideas clearly and feel more at home with the language they
            meet in secondary school and further study. Books and practice
            papers still matter; MineWords is here to make learning the words
            inside them easier to keep up with.
          </p>
        </section>

        <section className="about-resources">
          <div className="about-section-icon">
            <BookOpen size={22} />
          </div>
          <div>
            <div className="eyebrow">BOOKS & LEARNING RESOURCES</div>
            <h2>Our family recommendations are on the way.</h2>
            <p>
              We’re putting together a short list of vocabulary books and
              practice resources we found helpful. We’ll add the links here
              soon.
            </p>
          </div>
          <span className="coming-soon">COMING SOON</span>
        </section>

        <section className="about-community">
          <article className="about-community-card tech-family">
            <div className="about-community-icon">
              <ListChecks size={22} />
            </div>
            <div className="eyebrow">REVISION THAT FITS YOUR FAMILY</div>
            <h2>Take your word list beyond the screen.</h2>
            <p>
              Prefer paper revision or making your own word cards? Use the word
              list to find vocabulary that needs more practice, then print a
              revision sheet or export it for your own family activities.
              Exports include meanings, examples, synonyms and antonyms, so you
              have useful material ready to discuss together.
            </p>
            <p className="playful-note">
              Printing and exports are included during full-access trials and
              with membership.
            </p>
            <Link className="about-repo-link" href="/words">
              <ListChecks size={17} /> View and export the word list{" "}
              <ArrowRight size={16} />
            </Link>
          </article>
          <article className="about-community-card access-family">
            <div className="about-community-icon">
              <HeartHandshake size={22} />
            </div>
            <div className="eyebrow">FOR FAMILIES WHO NEED A HAND</div>
            <h2>Education should be within reach.</h2>
            <p>
              If the membership cost would make it difficult for your family,
              please get in touch. If you can share proof that your child
              qualifies for free school meals or other government low-income
              support, I’ll do my best to arrange free access.
            </p>
            <p>
              Hosting has ongoing costs, and building and maintaining MineWords
              takes a lot of time. I’m grateful to families who are able to
              support it with a membership, and I’ll try to help those who
              cannot.
            </p>
            <p className="playful-note">
              Try a few short sessions together before deciding to subscribe.
              Choose a pace that feels positive for your child, and take a break
              when they need one. Their wellbeing comes first.
            </p>
          </article>
        </section>

        <section className="about-cta">
          <div>
            <h2>Try it together. See how it fits.</h2>
            <p>
              Start with free practice and explore the way your child learns.
            </p>
            <p>
              When you’re ready, membership brings the full vocabulary
              collection, focused revision and printable word lists together.
              Visit your account for trial details and membership pricing.
            </p>
          </div>
          <Link className="primary-button" href="/account">
            Explore membership <ArrowRight size={17} />
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
