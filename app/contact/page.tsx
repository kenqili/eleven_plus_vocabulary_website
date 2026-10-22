import Link from "next/link";
import Header from "@/components/minewords/header";
import ContactForm from "@/components/minewords/contact-form";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/contact";
import { turnstileClientKey } from "@/lib/server/turnstile";

export const metadata = {
  title: "Contact us · MineWords",
};

/**
 * Rendered per request because the human check's public key is a setting of the
 * deployment: a prerendered page would bake in whichever key existed at build
 * time, which is usually none.
 */
export const dynamic = "force-dynamic";

/**
 * How to reach a human.
 *
 * A form that sends to the support address, with the address itself printed
 * beside it: a parent on a machine where the form fails, or who simply
 * prefers their own email, still has somewhere to go. The address comes from
 * the one constant, so the two can never disagree.
 */
export default function ContactPage() {
  return (
    <>
      <Header />
      <main className="workspace">
        <Link className="text-button" href="/practice">
          ← Back to practice
        </Link>
        <div className="page-heading">
          <div>
            <div className="eyebrow">WE READ EVERYTHING</div>
            <h1>Contact us.</h1>
            <p className="muted">
              Something wrong with your account, or advice for us? Write
              below, or email{" "}
              <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a> directly.
            </p>
          </div>
        </div>
        <section className="account-card">
          <ContactForm turnstileSiteKey={turnstileClientKey()} />
        </section>
        <footer className="site-footer">
          <span>Small steps. Lasting knowledge.</span>
          <span>11+ VOCABULARY CHALLENGE</span>
        </footer>
      </main>
    </>
  );
}
