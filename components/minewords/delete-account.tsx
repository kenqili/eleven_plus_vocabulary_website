"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "@/lib/client/api";

/**
 * Removes the account and everything in it.
 *
 * A parent who wants their child's record gone should not have to email the
 * developer, and should be told what is being removed rather than asked to
 * trust that something is. The password is required, the wording is plain about
 * what does not come back, and the button is not the one under the cursor.
 */
export default function DeleteAccount() {
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<number | null>(null);

  if (done !== null)
    return (
      <p className="manage-notice" role="status">
        That is everything gone. {done === 1 ? "One practice record" : `${done} practice records`}{" "}
        and the account itself have been deleted. Thanks for letting us help.
      </p>
    );

  if (!asking)
    return (
      <div className="account-danger">
        <button
          type="button"
          className="text-button"
          onClick={() => setAsking(true)}
        >
          <Trash2 size={15} aria-hidden /> Delete this account
        </button>
        <p className="muted">
          Removes the account, every word your child has practised, their
          stories, badges and any words you added.
        </p>
      </div>
    );

  return (
    <div className="account-danger">
      <h2>Delete this account</h2>
      <p>
        This removes the account and everything in it, including{" "}
        <strong>every practice record and reading position</strong>. It cannot
        be undone, and there is no copy kept anywhere.
      </p>
      <label htmlFor="delete-password">Your password</label>
      <input
        id="delete-password"
        type="password"
        autoComplete="current-password"
        maxLength={200}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <label htmlFor="delete-confirm">
        Type <strong>delete</strong> to confirm
      </label>
      <input
        id="delete-confirm"
        maxLength={20}
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      {error ? (
        <p className="manage-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="control-row">
        <button
          type="button"
          className="manage-action destructive"
          disabled={busy || !password || confirm.trim().toLowerCase() !== "delete"}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const result = await api<{ removed: { records: number } }>(
                "/api/auth/delete",
                { password },
              );
              setDone(result.removed.records);
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "Could not delete it.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete everything
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            setAsking(false);
            setPassword("");
            setConfirm("");
            setError("");
          }}
        >
          Keep my account
        </button>
      </div>
    </div>
  );
}
