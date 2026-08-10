#!/usr/bin/env bash
# Open the deployed portal's operator surfaces to everyone — no token asked.
#
# WHAT THIS DOES, AND WHY IT IS A SCRIPT
#
# Sets ALPHAENGINE_OPERATOR_OPEN=1 on the Vercel production environment and
# redeploys so it takes effect. The web code already understands the flag
# (lib/operator.ts, "open-demo" mode): the order ticket, kill switch and
# remediation work for anyone with the URL, and the token field disappears
# from the Reliability panel. Reviewers click Send; nobody pastes anything.
#
# It is a script because the two commands have now failed twice by hand — once
# because interactive zsh passed a trailing "# comment" to vercel as arguments,
# once because they were run from the repo root where no Vercel project is
# linked. Automation is cheaper than a third diagnosis. It is run BY A HUMAN
# rather than by CI because opening the demo is a decision about a live
# deployment, and decisions get a person's enter key.
#
# WHAT IT DELIBERATELY DOES NOT DO
#
# It does not touch ALPHAENGINE_OPERATOR_TOKEN (open-demo outranks it; leaving
# it set means removing the flag falls back to token mode, not to locked), and
# it does not touch the gateway's own credential, which never leaves the
# server. Undo: npx vercel env rm ALPHAENGINE_OPERATOR_OPEN production, then
# redeploy the same way.

set -euo pipefail

cd "$(dirname "$0")/../web"

echo "==> Setting ALPHAENGINE_OPERATOR_OPEN=1 on Vercel production"
if ! printf '1' | npx vercel env add ALPHAENGINE_OPERATOR_OPEN production; then
  # Already exists (a half-completed earlier run): replace rather than fail.
  echo "==> Variable exists — replacing it"
  npx vercel env rm ALPHAENGINE_OPERATOR_OPEN production --yes
  printf '1' | npx vercel env add ALPHAENGINE_OPERATOR_OPEN production
fi

echo "==> Redeploying so the flag takes effect"
if ! npx vercel redeploy developer-analyst-infra.vercel.app; then
  # The alias form is not accepted by every CLI version; an empty commit
  # reaches the same build through the GitHub integration instead.
  echo "==> Alias redeploy refused — triggering via empty commit"
  git commit --allow-empty -m "chore: redeploy to pick up ALPHAENGINE_OPERATOR_OPEN"
  git push
fi

echo
echo "Done. In ~1 minute, verify with:"
echo "  curl -s https://developer-analyst-infra.vercel.app/api/system/health | grep -o '\"mode\":\"[a-z-]*\"'"
echo "Expected: \"mode\":\"open-demo\" — then the portal needs no token from anyone."
