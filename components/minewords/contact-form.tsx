"use client";
import { useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import Turnstile from "./turnstile";

/**
 * The form on the contact page.
 *
 * Three fields and one outcome: either the message is accepted, or the page
 * says plainly what to fix or where to write instead. The address itself is
 * printed on the page beside this, so a parent whose message will not send
 * still has somewhere to go.
 *
 * A human check sits before the button when the server is configured for one.
 * This is the only form on the site a stranger can use to make it send mail, so
 * it is the one that needs it most.
 */
export default function ContactForm({ turnstileSiteKey }: { turnstileSiteKey: string }) {
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("account");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [check, setCheck] = useState(0);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/contact", { email, topic, message, turnstileToken: token });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
      // A token is spent by the attempt, whether the attempt got as far as the
      // challenge or not, so the next one needs a fresh check.
      setCheck((count) => count + 1);
    } finally {
      setBusy(false);
    }
  }
  if (sent) {
    return (
      <p role="status">
        Thank you — your message is on its way. We read everything and reply
        as soon as we can.
      </p>
    );
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor="contact-email">Your email address</label>
      <input
        id="contact-email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
      />
      <label htmlFor="contact-topic">What is it about?</label>
      <select
        id="contact-topic"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
      >
        <option value="account">Something wrong with my account</option>
        <option value="feedback">Advice or feedback</option>
        <option value="other">Something else</option>
      </select>
      <label htmlFor="contact-message">Your message</label>
      <textarea
        id="contact-message"
        required
        minLength={10}
        maxLength={2000}
        rows={6}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Tell us what happened, or what you think we should know."
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <Turnstile siteKey={turnstileSiteKey} onToken={setToken} resetSignal={check} />
      <button className="primary-button" disabled={busy}>
        {busy ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
