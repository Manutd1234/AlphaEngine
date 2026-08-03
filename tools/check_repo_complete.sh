#!/usr/bin/env bash
#
# Does the COMMITTED tree build? — run before every push.
# =======================================================
#
# Building in the working tree proves nothing about what was committed. A file
# that exists on disk but is excluded by .gitignore compiles locally and then
# fails on the deployment host with "Module not found". That is exactly how
# `web/lib/livebook.ts` shipped broken: a pasted-in language template contained
# a bare `lib/` pattern, which matches at any depth, so `git add -A` skipped it
# in silence.
#
# This exports HEAD to a scratch directory — only what git actually has — and
# builds there.
#
#   tools/check_repo_complete.sh            # audit + build the committed tree
#   tools/check_repo_complete.sh --fast     # audit only, skip npm install/build
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
fail=0
note() { printf '  %s%s%s\n' "$DIM" "$1" "$OFF"; }
pass() { printf '  %sPASS%s  %s\n' "$GREEN" "$OFF" "$1"; }
bad()  { printf '  %sFAIL%s  %s\n' "$RED" "$OFF" "$1"; fail=1; }
warn() { printf '  %sWARN%s  %s\n' "$YELLOW" "$OFF" "$1"; }

echo "▸ 1. Source files excluded by .gitignore"
# Anything that looks like source but git is ignoring is a silent-drop candidate.
ignored_source=$(git ls-files --others --ignored --exclude-standard \
  | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|py|css|html|json|md|sh|yml|yaml)$' \
  | grep -vE 'node_modules/|\.next/|venv/|__pycache__|\.pytest_cache/|package-lock\.json|next-env\.d\.ts|tsbuildinfo' \
  || true)
if [[ -n "$ignored_source" ]]; then
  bad "these source files are ignored and will never reach the deployment:"
  printf '        %s\n' $ignored_source
  printf '        %swhy:%s\n' "$DIM" "$OFF"
  for f in $ignored_source; do printf '        %s\n' "$(git check-ignore -v "$f")"; done
else
  pass "no source file is being silently dropped"
fi

echo "▸ 2. Unanchored directory patterns in .gitignore"
# `lib/` matches at ANY depth; `/web/lib/` matches one place. Only the second is safe
# in a polyglot repo.
risky=$(grep -nE '^[a-zA-Z_][a-zA-Z0-9_.-]*/$' .gitignore \
  | grep -vE ':(node_modules|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.ipynb_checkpoints)/$' || true)
if [[ -n "$risky" ]]; then
  bad "unanchored directory patterns (add a leading / to scope them):"
  printf '        %s\n' "$risky"
else
  pass "all directory patterns are anchored or known-safe"
fi

echo "▸ 3. Uncommitted changes"
if [[ -n "$(git status --porcelain)" ]]; then
  warn "working tree is dirty — the committed tree is not what you are testing:"
  git status --porcelain | sed 's/^/        /'
else
  pass "working tree is clean"
fi

echo "▸ 4. Secrets"
if git grep -I -q -E '[0-9]{8,10}:[A-Za-z0-9_-]{30,}' -- . 2>/dev/null; then
  bad "something shaped like a bot token is committed"
  git grep -I -n -E '[0-9]{8,10}:[A-Za-z0-9_-]{30,}' -- . | head -5 | sed 's/^/        /'
else
  pass "no committed credentials"
fi

echo "▸ 5. Import case sensitivity (macOS is case-insensitive, Linux is not)"
if command -v node >/dev/null 2>&1; then
  node - <<'NODE'
const { execSync } = require("child_process");
const fs = require("fs"), path = require("path");
const files = execSync("git ls-files 'web/**/*.ts' 'web/**/*.tsx'", { encoding: "utf8" })
  .split("\n").filter(Boolean);
let bad = 0, n = 0;
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/from\s+"(\.[^"]+|@\/[^"]+)"/g)) {
    const spec = m[1];
    const base = spec.startsWith("@/") ? path.join("web", spec.slice(2)) : path.join(path.dirname(f), spec);
    n++;
    const dir = path.dirname(base), stem = path.basename(base);
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch { console.log(`        missing dir: ${f} -> ${spec}`); bad++; continue; }
    // Exact-case match only — this is what Linux will do.
    if (!entries.some(e => e === `${stem}.ts` || e === `${stem}.tsx` || e === stem)) {
      console.log(`        UNRESOLVED (case or missing): ${f} -> ${spec}`); bad++;
    }
  }
}
console.log(bad === 0
  ? `  \x1b[32mPASS\x1b[0m  ${n} imports resolve with exact case`
  : `  \x1b[31mFAIL\x1b[0m  ${bad} of ${n} imports would fail on Linux`);
process.exit(bad === 0 ? 0 : 1);
NODE
  [[ $? -ne 0 ]] && fail=1
else
  warn "node not found — skipped"
fi

if [[ $FAST -eq 1 ]]; then
  echo
  [[ $fail -eq 0 ]] && echo "${GREEN}audit clean${OFF} (build skipped: --fast)" || echo "${RED}audit failed${OFF}"
  exit $fail
fi

echo "▸ 6. Build the committed tree (not the working tree)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
git archive HEAD | tar -x -C "$WORK"
note "exported HEAD ($(git rev-parse --short HEAD)) -> $WORK"

if [[ ! -f "$WORK/web/package.json" ]]; then
  bad "web/package.json is not in the committed tree"
else
  (
    cd "$WORK/web"
    npm ci --silent >/dev/null 2>&1 || npm install --silent >/dev/null 2>&1
    if npx --no-install next build >"$WORK/build.log" 2>&1; then
      pass "committed tree builds ($(grep -c '' "$WORK/build.log") log lines)"
    else
      bad "committed tree FAILS to build:"
      grep -E "Module not found|Failed to compile|Error:|Type error" "$WORK/build.log" | head -10 | sed 's/^/        /'
      exit 1
    fi
  ) || fail=1
fi

echo
if [[ $fail -eq 0 ]]; then
  echo "${GREEN}✓ the committed tree is complete and builds${OFF}"
else
  echo "${RED}✗ do not push${OFF}"
fi
exit $fail
