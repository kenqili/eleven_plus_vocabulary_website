#!/usr/bin/env bash
#
# Deploy the Worker, having first made sure its database can answer the code.
#
# The order is the entire point, and it is the order that was got wrong for weeks
# in this repository. `wrangler d1 migrations apply` runs before `wrangler deploy`,
# never after, because the code and the schema have to agree at every moment
# traffic is being served. A deploy that adds a column the Worker reads on its
# first request is an outage, not a slow rollout, and rolling it back does not
# help because the old code was fine with the old schema.
#
# Three things this does that a bare `wrangler deploy` does not:
#
#   1. Verifies first. Typecheck, lint and the tests, including the check that the
#      drizzle journal covers every migration on disk. A migration that is not
#      journalled is one this script will never apply, and nothing else would
#      notice - which is how 0010 to 0013 went missing.
#   2. Patches the generated wrangler config to point at the migrations directory.
#      vinext writes dist/server/wrangler.json at build time and has no
#      migrations_dir in it, so `d1 migrations apply` has nothing to read. Rather
#      than hand-maintain a second config that can drift, the generated one is
#      amended in place after every build.
#   3. Applies migrations idempotently. `wrangler d1 migrations apply` records
#      what it ran in a d1_migrations table and skips those next time. The manual
#      `d1 execute --file` route this replaces was not idempotent - a migration
#      that had already run failed when run again - which is why applying anything
#      by hand needed a probe first.
#
# Usage:
#   scripts/deploy.sh                        verify, build, migrate, deploy
#   scripts/deploy.sh --skip-verify          assume the caller already ran the suite
#   scripts/deploy.sh --no-build             assume the caller already built, which is
#                                           what Cloudflare Workers Builds does: it
#                                           runs the build command, then the deploy
#                                           command, and building twice in a deploy is
#                                           a few wasted minutes at best
#   scripts/deploy.sh --dry-run              everything except the wrangler commands
#
# Which database it migrates
# ------------------------
# With --no-build it takes the database id from the wrangler config the build just
# produced, so it cannot be pointed at the wrong one by a stale environment
# variable. Without it, D1_ID and D1_NAME are required, because there is no config
# to read yet.
#
# Environment: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. D1_ID and D1_NAME
# select the database, exactly as the build does.
set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
SKIP_VERIFY=0
NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-verify) SKIP_VERIFY=1 ;;
    --no-build) NO_BUILD=1 ;;
    *) printf 'unknown option: %s\n' "$arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
wrangler() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '  (dry run) wrangler %s\n' "$*"
  else
    npx wrangler "$@"
  fi
}

if [ "$SKIP_VERIFY" = "1" ]; then
  say "1/4  Verifying (skipped, as asked)"
else
  say "1/4  Verifying"
  npm run typecheck
  npm run lint
  npm test
fi

if [ "$NO_BUILD" = "1" ]; then
  # Cloudflare ran the build command already. Its output is what this deploys, so
  # it has to be there; saying so plainly beats failing later inside wrangler.
  if [ ! -f dist/server/wrangler.json ]; then
    printf 'no dist/server/wrangler.json, so there is nothing to deploy. Build first, or drop --no-build.\n' >&2
    exit 1
  fi
  say "2/4  Building (skipped, as asked)"
else
  say "2/4  Building"
  # Required here rather than defaulted, because there is no config to read the
  # id from yet and a wrong default would migrate a database nobody reads.
  export D1_ID="${D1_ID:?set D1_ID to the production D1 database id}"
  export D1_NAME="${D1_NAME:?set D1_NAME to the production D1 database name}"
  npm run build
fi

say "3/4  Pointing the generated wrangler config at the migrations"
node scripts/patch-wrangler-migrations.mjs

say "4/4  Migrations, then the Worker"
# Applied first, and separately from the deploy on purpose. If a migration fails,
# this exits non-zero and the Worker is never updated - so the site keeps serving
# the code that matches the database it already has.
# "DB" is the binding, taken from the config rather than hardcoded, so a renamed
# binding is a loud failure here instead of a silent migration of nothing.
BINDING=$(node -e "const c=require('./dist/server/wrangler.json');const b=(c.d1_databases??c.d1)[0];if(!b)process.exit(1);process.stdout.write(b.binding)")

wrangler d1 migrations list "$BINDING" --remote --config dist/server/wrangler.json || true
wrangler d1 migrations apply "$BINDING" --remote --config dist/server/wrangler.json
wrangler deploy --config dist/server/wrangler.json

say "Done"
