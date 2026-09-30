# Rules for changing this repository

## Migrations: `wrangler d1 migrations apply` is the whole mechanism

Apply pending migrations in order, recording each in `d1_migrations`. With no
ledger it creates one and starts at `0000`. That is the entire design, it is
correct, and nothing is needed around it.

**Never**

- apply a migration file with `wrangler d1 execute --file`. It records nothing,
  which is what leaves a database with a complete schema and an empty ledger — and
  the next `apply` then re-runs `0000` and stops on `table "attempts" already
  exists`.
- seed, backfill, repair or reconcile `d1_migrations`. Not from `scripts/`, not
  before a deploy, not from the dashboard.
- add a check, probe, guard or preflight in front of `migrations apply`.

**When a migration fails, the fix is the database, never the machinery.** If
`apply` cannot apply a migration, either the migration SQL is wrong — fix the
SQL, in a new migration — or the database is in a state `apply` did not create,
in which case empty it and let `apply` rebuild it from `0000`. Deleting and
recreating the D1 database is worse than emptying it: it issues a new
`database_id`, so `D1_ID` has to change in two places, and if they disagree the
Worker reads one database while migrations land in another.

This is not hypothetical. Production sat for weeks with tables and no ledger
because it had only ever been migrated by hand, and every deploy failed at
`0000`. It was emptied once and `apply` rebuilt it. That was the entire
incident, and it needed no code.

## Prefer the platform mechanism to a wrapper around it

A check that reads a tool's output and branches on it is not robustness, it is a
new failure mode: if that output changes shape, the check stops a deploy that
would have succeeded. The same goes for any second system layered next to
something that already works — it has to stay in step with the first, and
nothing enforces that.

Before adding a script, a test or a guard, answer: what does the platform or the
existing code not already do correctly? If the answer is "nothing", write the
code that does the thing. If the answer is "it fails on this one input", fix
that input — one incident is not a class of problem, and machinery built for a
class that does not exist is cost with no benefit.

## Ask before widening the blast radius

Writing to a production database, changing deploy behaviour, or touching what a
deploy asserts are all things to propose and get agreement for first. "Make it
robust" is not permission to add machinery; if the honest answer is that the
existing script is already correct, say so and change nothing.
