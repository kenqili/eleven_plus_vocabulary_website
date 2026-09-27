import Header from "@/components/minewords/header";

/**
 * The privacy notice, in one page and in plain English.
 *
 * Two parents reviewing this asked where a child's data goes and how to get it
 * deleted, and neither answer was anywhere on the site. It is written to be read
 * rather than to be defensible, and it says what the schema actually does.
 */
export const metadata = { title: "Privacy · MineWords" };

export default function PrivacyPage() {
  return (
    <div className="site">
      <Header />
      <main className="workspace guides-workspace">
        <section className="guides-hero">
          <div>
            <div className="eyebrow">PRIVACY</div>
            <h1>What this app stores, and how to get rid of it.</h1>
            <p>
              MineWords is for children in the UK preparing for selective school
              entrance. That shapes everything below: there is as little here as
              we could manage, and it is all removable by you.
            </p>
          </div>
        </section>

        <article className="guide-article">
          <h2>Who this is for</h2>
          <p>
            The account belongs to the grown-up. A child never needs to create
            one, and we never ask for a child&rsquo;s name, date of birth,
            photograph, school or address. The app does not know who the child
            is.
          </p>

          <h2>What is stored</h2>
          <ul>
            <li>
              <strong>Your account:</strong> an email address, a salted password
              hash, and a session token. That is all.
            </li>
            <li>
              <strong>Your child&rsquo;s practice:</strong> one row per question
              answered — the word, the question, the four options, which was
              chosen, whether it was right, whether a clue was asked for, and
              how long it took. This is what makes progress tracking and spaced
              revision work.
            </li>
            <li>
              <strong>Reading:</strong> how far through each story they had
              read, so they can pick up where they left off, and which stories
              are finished.
            </li>
            <li>
              <strong>Time:</strong> total time spent practising, per day, so the
              calendar can show a pattern.
            </li>
            <li>
              <strong>Words you add:</strong> the word, its meaning and a sample
              sentence, which you typed in.
            </li>
          </ul>
          <p>
            The word list itself is a static data file that ships with the app.
            It contains no personal information and is not user-specific.
          </p>

          <h2>What is not done with it</h2>
          <ul>
            <li>Not sold, rented or shared for advertising. There are no third-party trackers or analytics on this site.</li>
            <li>Not used to build a profile of a child for any purpose.</li>
            <li>No email is sent about the child. The only message we send is a sign-in link or a receipt from the payment provider.</li>
          </ul>

          <h2>Payments</h2>
          <p>
            Payments are handled by Stripe. Your card details go to them and
            never touch our servers; we store only a reference to a subscription
            and its status. Their own privacy policy governs what they keep.
          </p>

          <h2>How long it is kept</h2>
          <p>
            Until you delete it. There is no automatic expiry, because a
            practice record that quietly disappears would be worse than one that
            stays. Your account page removes all of it in one step.
          </p>

          <h2>Deleting everything</h2>
          <p>
            <a href="/account">Your account page</a> has{" "}
            <strong>Delete this account</strong> at the bottom. It asks for your
            password, tells you exactly what will be removed, and deletes the
            account and every practice record, story position, badge and added
            word in it. It cannot be undone, and no copy is kept. This is a real
            deletion, not a request we might not read.
          </p>

          <h2>Free school meals and hardship access</h2>
          <p>
            We offer free access to families who need it. If you ask for it, you
            may email proof of eligibility. That evidence is held only in the
            mailbox of the person who reads it, is used for that one decision,
            and is deleted afterwards. It is not stored in the app and never
            appears in any child&rsquo;s record.
          </p>

          <h2>The short version</h2>
          <p>
            One email address, one row per question answered, and how far
            through each story your child got. No name, no advertising, no
            sharing, and one button on your account page removes all of it.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about any of this can go to the address on the{" "}
            <a href="/about">about page</a>. If you want something removed that
            this page does not cover, ask and it will be.
          </p>
        </article>

        <footer className="site-footer">
          <span>Small steps. Lasting knowledge.</span>
          <span>MINEWORDS · LEARNING, WORD BY WORD</span>
        </footer>
      </main>
    </div>
  );
}
