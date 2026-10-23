"use client";

/**
 * The administrator's page: issue codes, and see how many have gone.
 *
 * Rendered for everyone who asks for `/admin`, and shows nothing useful to anyone
 * who is not the administrator - the API answers 404 to them, so there is no
 * second check here that could disagree with the first. A client-side gate would
 * be a comment about a security boundary rather than one, and this one is the
 * server's job alone.
 *
 * Codes are shown once, in full, and are not fetchable again afterwards. They
 * cannot be: they are stored as the parent types them, not as a hash, because a
 * parent has to be able to type one. So this is the only moment they are ever
 * displayed, which is what the copy below is for.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound, ShieldCheck } from "lucide-react";
import Header from "./header";
import { api } from "@/lib/client/api";

const LENGTHS = [
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
  { days: 365, label: "1 year" },
];

type DiscountCodeRow = {
  id: string;
  label: string;
  /** Null when the code is ours rather than a tutor's. */
  tutorId: string | null;
  tutorName: string | null;
  contact: string | null;
  tier: string;
  percentOff: number;
  maxRedemptions: number;
  redeemed: number;
  expiresAt: number;
  status: string;
  createdAt: number;
};

type DueAccount = {
  id: string;
  email: string;
  createdAt: number;
  /** Null for an address nobody ever confirmed, which was never used. */
  lastUsedAt: number | null;
};

type DueAccounts = {
  unconfirmed: DueAccount[];
  dormant: DueAccount[];
};

type Stats = {
  issued: number;
  redeemed: number;
  batches: {
    batch: string;
    days: number;
    issued: number;
    redeemed: number;
  }[];
  discountCodes: DiscountCodeRow[];
  dueAccounts: DueAccounts;
};

export default function AdminPage() {
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tutorName, setTutorName] = useState("");
  const [tutorContact, setTutorContact] = useState("");
  const [tutorBusy, setTutorBusy] = useState(false);
  const [tutorError, setTutorError] = useState("");
  const [issuedLabel, setIssuedLabel] = useState<string | null>(null);
  const [voucherName, setVoucherName] = useState("");
  const [voucherPercent, setVoucherPercent] = useState(20);
  const [voucherBusy, setVoucherBusy] = useState(false);
  const [voucherError, setVoucherError] = useState("");
  const [voucherLabel, setVoucherLabel] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DueAccount | null>(null);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteDone, setDeleteDone] = useState<string | null>(null);

  function load() {
    // No second argument. `api(path, data)` sends a POST for any truthy `data`,
    // and `{}` is truthy - so passing it turned this read into a POST, which is
    // the action that issues a batch. The counts panel could therefore never
    // render, every batch burned two of the ten rate-limit slots instead of one,
    // and the administrator saw "Choose a length." under a batch that had just
    // succeeded.
    return api<Stats>("/api/admin")
      .then(setStats)
      .catch((cause) => {
        setError(
          cause instanceof Error ? cause.message : "Could not load that.",
        );
      });
  }

  async function issue() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ codes: string[] }>("/api/admin", { days });
      setCodes(result.codes);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not do that.");
    } finally {
      setBusy(false);
    }
  }

  // Reads the page once on arrival. It used to read only after a batch was
  // generated, so the counts - and the accounts due for deletion - were blank on
  // the first visit, and the "refresh" button that would have filled them was
  // inside the panel that had nothing to show.
  useEffect(() => {
    // A promise chain rather than a bare call: the lint rule that discourages
    // setState from an effect reads the bare version as a synchronous update.
    void load().then(() => undefined);
  }, []);

  async function issueTutorCode() {
    setTutorBusy(true);
    setTutorError("");
    setIssuedLabel(null);
    try {
      const result = await api<{ label: string }>("/api/admin", {
        action: "issue-tutor-code",
        tutorName,
        contact: tutorContact,
      });
      setIssuedLabel(result.label);
      setTutorName("");
      setTutorContact("");
      await load();
    } catch (cause) {
      setTutorError(
        cause instanceof Error ? cause.message : "Could not do that.",
      );
    } finally {
      setTutorBusy(false);
    }
  }

  async function issueVoucher() {
    setVoucherBusy(true);
    setVoucherError("");
    setVoucherLabel(null);
    try {
      const result = await api<{ label: string }>("/api/admin", {
        action: "issue-house-voucher",
        label: voucherName,
        percentOff: voucherPercent,
      });
      setVoucherLabel(result.label);
      setVoucherName("");
      await load();
    } catch (cause) {
      setVoucherError(
        cause instanceof Error ? cause.message : "Could not do that.",
      );
    } finally {
      setVoucherBusy(false);
    }
  }

  async function suspendDiscountCode(codeId: string) {
    setTutorError("");
    try {
      await api("/api/admin", { action: "suspend-discount-code", codeId });
      await load();
    } catch (cause) {
      setTutorError(
        cause instanceof Error ? cause.message : "Could not do that.",
      );
    }
  }

  /**
   * Delete the account the administrator has named.
   *
   * The address has to be typed out first. Not a security control - the server
   * refuses an account that is not on its list either way - but two lists of
   * similar rows is exactly where the wrong row gets pressed, and the address is
   * the one thing that cannot be mistaken for the row below it.
   */
  async function deleteAccount() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError("");
    setDeleteDone(null);
    try {
      const result = await api<{ removed: { records: number } }>("/api/admin", {
        action: "delete-account",
        userId: deleteTarget.id,
        email: deleteTyped,
      });
      setDeleteDone(
        `${deleteTarget.email} is gone, with ${result.removed.records} practice ${
          result.removed.records === 1 ? "record" : "records"
        }.`,
      );
      setDeleteTarget(null);
      setDeleteTyped("");
      await load();
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? cause.message : "Could not delete it.",
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  function askToDelete(account: DueAccount) {
    setDeleteTarget(account);
    setDeleteTyped("");
    setDeleteError("");
    setDeleteDone(null);
  }

  return (
    <>
      <Header />
      <main className="workspace">
        <h1 className="workspace-title">
          <ShieldCheck size={22} aria-hidden /> Administrator
        </h1>

        <section className="manage-panel">
          <h2>Issue coupon codes</h2>
          <p className="muted">
            Thirty-two codes at a time, each worth the same length. A code
            grants that much access with nothing to pay: the family enters it on
            their account page and it extends their child&apos;s access from
            whatever date they already have. Issue one to a family who needs it
            - because the cost is a problem, or because somebody has arranged to
            cover it for them. A code works once.
          </p>
          <div className="account-actions">
            {LENGTHS.map((length) => (
              <label key={length.days} className="radio-option">
                <input
                  type="radio"
                  name="days"
                  value={length.days}
                  checked={days === length.days}
                  onChange={() => setDays(length.days)}
                />
                {length.label}
              </label>
            ))}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="account-actions">
            <button className="primary-button" disabled={busy} onClick={issue}>
              Generate 32 codes
            </button>
            {stats && (
              <button className="text-button" onClick={() => void load()}>
                Refresh counts
              </button>
            )}
          </div>

          {codes && (
            <div className="coupon-codes">
              {/* role="status" so a screen reader hears the codes exist without
                  having to find them, and because a sighted admin generating a
                  batch needs the same announcement. */}
              <p role="status">
                {codes.length} codes generated. They are shown once and cannot
                be shown again - copy them now.
              </p>
              <textarea
                readOnly
                rows={8}
                value={codes.join("\n")}
                aria-label="Generated coupon codes"
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="account-actions">
                <button
                  className="text-button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(codes.join("\n"));
                  }}
                >
                  Copy all
                </button>
                <button className="text-button" onClick={() => setCodes(null)}>
                  Hide
                </button>
              </div>
            </div>
          )}
        </section>

        {stats && (
          <section className="manage-panel">
            <h2>Issued so far</h2>
            <p className="muted">
              {stats.issued} codes issued, {stats.redeemed} redeemed.
            </p>
            <div className="word-table-wrap">
              <table className="word-table">
                <thead>
                  <tr>
                    <th scope="col">Length</th>
                    <th scope="col">Issued</th>
                    <th scope="col">Redeemed</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.batches.map((row) => (
                    <tr key={row.batch}>
                      <td>{row.days} days</td>
                      <td>{row.issued}</td>
                      <td>{row.redeemed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="manage-panel">
          <h2>Tutor discount codes</h2>
          <p className="muted">
            One code per tutor, taking 20% off the 1-year option for up to 100
            students over 12 months. Hand the code to the tutor; students enter
            it on their account page before paying. The count below is how many
            have used it - that is the number the private split is worked out
            from.
          </p>
          <div className="account-actions">
            <label>
              Tutor&apos;s name
              <input
                type="text"
                value={tutorName}
                onChange={(event) => setTutorName(event.target.value)}
                placeholder="e.g. Sarah Chen"
                autoComplete="off"
              />
            </label>
            <label>
              Contact (optional)
              <input
                type="text"
                value={tutorContact}
                onChange={(event) => setTutorContact(event.target.value)}
                placeholder="Email or phone"
                autoComplete="off"
              />
            </label>
          </div>
          {tutorError && (
            <p className="form-error" role="alert">
              {tutorError}
            </p>
          )}
          <div className="account-actions">
            <button
              className="primary-button"
              disabled={tutorBusy || !tutorName.trim()}
              onClick={() => void issueTutorCode()}
            >
              Issue tutor code
            </button>
          </div>
          {issuedLabel && (
            <p role="status">
              Issued <strong>{issuedLabel}</strong> - send it to the tutor.
            </p>
          )}
        </section>

        <section className="manage-panel">
          <h2>Our own vouchers</h2>
          <p className="muted">
            A voucher for a promotion, not attached to a tutor: name it after
            the promotion and pick the discount. It works the same way on the
            account page, counts the same way, and is suspended the same way.
            The percent rides on the end of the label, so SUMMER-50 is 50% off.
          </p>
          <div className="account-actions">
            <label>
              Promotion name
              <input
                type="text"
                value={voucherName}
                onChange={(event) => setVoucherName(event.target.value)}
                placeholder="e.g. Summer sale"
                autoComplete="off"
              />
            </label>
            <label>
              Percent off the 1-year option
              <input
                type="number"
                min={1}
                max={90}
                step={1}
                value={voucherPercent}
                onChange={(event) =>
                  setVoucherPercent(Number(event.target.value))
                }
              />
            </label>
          </div>
          {voucherError && (
            <p className="form-error" role="alert">
              {voucherError}
            </p>
          )}
          <div className="account-actions">
            <button
              className="primary-button"
              disabled={voucherBusy || !voucherName.trim()}
              onClick={() => void issueVoucher()}
            >
              Issue voucher
            </button>
          </div>
          {voucherLabel && (
            <p role="status">
              Issued <strong>{voucherLabel}</strong> - share it however you
              like.
            </p>
          )}
        </section>

        {stats && stats.discountCodes.length > 0 && (
          <section className="manage-panel">
            <h2>Codes so far</h2>
            <div className="word-table-wrap">
              <table className="word-table">
                <thead>
                  <tr>
                    <th scope="col">Belongs to</th>
                    <th scope="col">Code</th>
                    <th scope="col">Discount</th>
                    <th scope="col">Used</th>
                    <th scope="col">Expires</th>
                    <th scope="col">Status</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.discountCodes.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.tutorName ?? "Us"}
                        {row.contact && (
                          <small className="muted"> {row.contact}</small>
                        )}
                      </td>
                      <td>{row.label}</td>
                      <td>{row.percentOff}% off 1 year</td>
                      <td>
                        {row.redeemed} of {row.maxRedemptions}
                      </td>
                      <td>
                        {new Date(row.expiresAt).toLocaleDateString("en-GB")}
                      </td>
                      <td>{row.status}</td>
                      <td>
                        {row.status === "active" && (
                          <button
                            className="text-button"
                            onClick={() => void suspendDiscountCode(row.id)}
                          >
                            Suspend
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="manage-panel">
          <h2>Accounts due for deletion</h2>
          <p className="muted">
            The privacy notice makes two promises about time: an account is
            deleted two years after it is last used, and a registration nobody
            confirmed is not kept either. Nothing here runs on a schedule. The
            promise is kept by somebody reading the address and the dates below
            and pressing Delete, which is the only deletion there is.
          </p>
          {stats ? (
            <>
              <h3>Never confirmed</h3>
              <p className="muted">
                Registered more than seven days ago, still unconfirmed, and with
                no confirmation link they asked for still valid - a link lasts a
                day, so nobody is deleted between asking for one and opening it.
                These cannot be signed into and cannot practise; each one is a
                claim on its address and on the password typed next to it.
              </p>
              {stats.dueAccounts.unconfirmed.length === 0 ? (
                <p className="muted">Nothing is due here.</p>
              ) : (
                <div className="word-table-wrap">
                  <table className="word-table">
                    <thead>
                      <tr>
                        <th scope="col">Address</th>
                        <th scope="col">Registered</th>
                        <th scope="col">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.dueAccounts.unconfirmed.map((row) => (
                        <tr key={row.id}>
                          <td>{row.email}</td>
                          <td>
                            {new Date(row.createdAt).toLocaleDateString("en-GB")}
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => askToDelete(row)}
                            >
                              Delete&hellip;
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h3>Not used for two years</h3>
              <p className="muted">
                Last signed in, practised or paid more than two years ago. A
                sign-in counts even when nothing was practised, which is why
                there is a date rather than only a count of answers.
              </p>
              {stats.dueAccounts.dormant.length === 0 ? (
                <p className="muted">Nothing is due here.</p>
              ) : (
                <div className="word-table-wrap">
                  <table className="word-table">
                    <thead>
                      <tr>
                        <th scope="col">Address</th>
                        <th scope="col">Registered</th>
                        <th scope="col">Last used</th>
                        <th scope="col">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.dueAccounts.dormant.map((row) => (
                        <tr key={row.id}>
                          <td>{row.email}</td>
                          <td>
                            {new Date(row.createdAt).toLocaleDateString("en-GB")}
                          </td>
                          <td>
                            {row.lastUsedAt
                              ? new Date(row.lastUsedAt).toLocaleDateString(
                                  "en-GB",
                                )
                              : "-"}
                          </td>
                          <td>
                            <button
                              className="text-button"
                              onClick={() => askToDelete(row)}
                            >
                              Delete&hellip;
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <p className="muted">
              {error
                ? "The lists could not be loaded."
                : "Loading the lists\u2026"}
            </p>
          )}

          <div className="account-actions">
            <button className="text-button" onClick={() => void load()}>
              Refresh lists
            </button>
          </div>

          {deleteTarget && (
            <div className="account-danger">
              <h2>Delete {deleteTarget.email}?</h2>
              <p>
                This removes the account and everything in it: every practice
                record, story position, badge and added word. It cannot be
                undone, and no copy is kept.
              </p>
              <label htmlFor="delete-address">
                Type the address to confirm
              </label>
              <input
                id="delete-address"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={deleteTyped}
                onChange={(event) => setDeleteTyped(event.target.value)}
              />
              {deleteError ? (
                <p className="manage-error" role="alert">
                  {deleteError}
                </p>
              ) : null}
              <div className="control-row">
                <button
                  type="button"
                  className="manage-action destructive"
                  disabled={
                    deleteBusy ||
                    deleteTyped.trim().toLowerCase() !== deleteTarget.email
                  }
                  onClick={() => void deleteAccount()}
                >
                  Delete for ever
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={deleteBusy}
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteTyped("");
                    setDeleteError("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {deleteDone && (
            <p className="manage-notice" role="status">
              {deleteDone}
            </p>
          )}
        </section>

        <p className="muted">
          <Link href="/account" className="text-button">
            <KeyRound size={15} aria-hidden /> Back to your account
          </Link>
        </p>
      </main>
    </>
  );
}
