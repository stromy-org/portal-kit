#!/usr/bin/env bash
# premerge-verify.sh: is the MERGED tree self-consistent?
#
# stromy-org's `scripts/premerge_review.py` runs this against the materialized
# merge tree (not the PR branch) and holds the merge on a non-zero exit. A branch
# that merges cleanly by hunk can still land a stale generated file or a lock that
# no longer matches package.json; this is where that becomes a refusal.
#
# Contract: exit 0 = consistent; read-only outside this tree; no network except
# reads (npm ci fetches the locked packages); every gate runs even after a red.
# Browser e2e is NOT here: it needs installed browsers and runs in CI.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

rc=0
gate() {
  local name="$1"; shift
  local out
  if out="$("$@" 2>&1)"; then
    printf '  OK   %s\n' "$name"
  else
    rc=1
    printf '  FAIL %s\n' "$name"
    printf '%s\n' "$out" | tail -n 30 | sed 's/^/       /'
  fi
}

echo "premerge-verify: portal-kit"
gate "org-core block == .agents/org-core.md" python3 scripts/check-org-core.py --check
gate "AGENTS.md -> CLAUDE.md + copilot-instructions" python3 scripts/render-agent-md.py --check

if ! command -v npm >/dev/null 2>&1; then
  echo "  FAIL npm is not installed; this tree cannot be verified, so the merge is held"
  exit 1
fi
# The version is stated once (package.json); the lock and the changelog must agree.
gate "package.json version == lock == CHANGELOG head" node -e '
  const fs = require("fs");
  const v = JSON.parse(fs.readFileSync("package.json")).version;
  const l = JSON.parse(fs.readFileSync("package-lock.json")).version;
  const c = (fs.readFileSync("CHANGELOG.md", "utf8").match(/^## v(\d+\.\d+\.\d+) /m) || [])[1];
  if (v !== l || v !== c) { console.error(`package ${v}, lock ${l}, changelog ${c}`); process.exit(1); }'
gate "lockfile installs exactly" npm ci --no-audit --no-fund --ignore-scripts
gate "typecheck" npm run typecheck
gate "unit and component tests" npm test

exit $rc
