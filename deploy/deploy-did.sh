#!/usr/bin/env bash
#
# Deploy the NYC Ferry departure display to juliet.nyc.
#
#   ~/deploy-did.sh                 # test, back up, sync, restart, verify
#   ~/deploy-did.sh --skip-tests    # skip the local test run
#   ~/deploy-did.sh --branch staff  # deploy a different branch
#   ~/deploy-did.sh --dry-run       # show what would change, touch nothing
#
# Deploys from `git archive <branch>`, i.e. committed code only — uncommitted
# work in the checkout is never shipped by accident.
#
# Two files on the box are deliberately NOT overwritten:
#   config/display.json            live device settings (landingNumber etc.)
#   public/data/display-data.json  regenerated at startup by build-data.js
# Anything else not in git (nyf-signage, state/, node_modules) is untouched
# because tar only writes the paths it carries.

set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/deploy-backup-lib.sh"

REPO="${DID_REPO:-$HOME/DiD_Open}"
BRANCH="${DID_BRANCH:-mobile}"
HOST="${DID_HOST:-ubuntu@52.5.187.46}"
KEY="${DID_KEY:-$HOME/julie.pem}"
APP_DIR="/opt/nyc-ferry-did"
SERVICE="nyc-ferry-did"
SITE="${DID_SITE:-https://ferrytimesmobile.juliet.nyc}"
KEEP_BACKUPS=5
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"

SKIP_TESTS=0
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-tests) SKIP_TESTS=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    --branch)     BRANCH="$2"; shift 2 ;;
    -h|--help)    sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

SSH=(ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$HOST")
say() { printf '\n\033[1;35m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "no git repo at $REPO"
git -C "$REPO" rev-parse --verify --quiet "$BRANCH" >/dev/null || die "no branch '$BRANCH' in $REPO"

LOCAL_SHA=$(git -C "$REPO" rev-parse "$BRANCH")
DEPLOYED_SHA=$("${SSH[@]}" "cat $APP_DIR/DEPLOYED_SHA 2>/dev/null" || true)

say "deploying ${BRANCH} → ${HOST}"
echo "  local:    ${LOCAL_SHA:0:7}  $(git -C "$REPO" log -1 --format=%s "$BRANCH")"
if [[ -n "$DEPLOYED_SHA" ]]; then
  echo "  deployed: ${DEPLOYED_SHA:0:7}"
  if [[ "$DEPLOYED_SHA" == "$LOCAL_SHA" ]]; then
    echo "  already up to date — nothing to do."; exit 0
  fi
  echo
  git -C "$REPO" log --oneline "${DEPLOYED_SHA}..${BRANCH}" | sed 's/^/    /'
  echo
  git -C "$REPO" diff --stat "${DEPLOYED_SHA}..${BRANCH}" | sed 's/^/    /'
else
  echo "  deployed: unknown (no DEPLOYED_SHA on the box)"
fi

# --- warn if the repo's config has keys the live config lacks -----------------
say "checking config drift"
REPO_CFG=$(git -C "$REPO" show "${BRANCH}:config/display.json" 2>/dev/null || echo '{}')
BOX_CFG=$("${SSH[@]}" "cat $APP_DIR/config/display.json" 2>/dev/null || echo '{}')
MISSING=$(python3 -c "
import json,sys
repo=json.loads(sys.argv[1]); box=json.loads(sys.argv[2])
print(' '.join(k for k in repo if k not in box))" "$REPO_CFG" "$BOX_CFG")
if [[ -n "$MISSING" ]]; then
  printf '  \033[1;33m! the branch adds config keys the live box does not have: %s\033[0m\n' "$MISSING"
  echo "    config/display.json is never overwritten, so add them by hand if the new code needs them:"
  echo "    ssh -i $KEY $HOST 'sudo -u ubuntu nano $APP_DIR/config/display.json'"
else
  echo "  no new config keys"
fi

if [[ "$DRY_RUN" == 1 ]]; then say "dry run — stopping before any changes"; exit 0; fi

# --- tests --------------------------------------------------------------------
if [[ "$SKIP_TESTS" == 1 ]]; then
  say "skipping tests (--skip-tests)"
else
  say "running tests"
  ( cd "$REPO" && npm test 2>&1 | tail -8 ) || die "tests failed — not deploying"
fi

# --- backup -------------------------------------------------------------------
STAMP=$(date +%Y%m%d-%H%M%S-%N)
BACKUP="$BACKUP_DIR/${SERVICE}-backup-${STAMP}.tgz"
ROLLBACK=$(local_backup_rollback "$BACKUP" "cd /opt && sudo tar xzf - && sudo systemctl restart $SERVICE")
say "backing up to $BACKUP on this machine"
backup_local "$BACKUP" "cd /opt && sudo tar --exclude=${SERVICE}/node_modules -czf - ${SERVICE}"

# --- sync ---------------------------------------------------------------------
say "syncing committed files from ${BRANCH}"
git -C "$REPO" archive "$BRANCH" \
  | "${SSH[@]}" "cd $APP_DIR && tar -x \
      --exclude=config/display.json \
      --exclude=public/data/display-data.json -f - && echo '  extracted'"

# --- dependencies -------------------------------------------------------------
if [[ -n "$DEPLOYED_SHA" ]] && ! git -C "$REPO" diff --quiet "${DEPLOYED_SHA}..${BRANCH}" -- package.json package-lock.json 2>/dev/null; then
  say "dependencies changed — running npm ci"
  "${SSH[@]}" "cd $APP_DIR && npm ci --omit=dev" 2>&1 | tail -3
fi

# --- restart ------------------------------------------------------------------
say "restarting $SERVICE"
"${SSH[@]}" "sudo systemctl restart $SERVICE"
sleep 4
STATE=$("${SSH[@]}" "systemctl is-active $SERVICE" || true)
if [[ "$STATE" != "active" ]]; then
  "${SSH[@]}" "sudo journalctl -u $SERVICE -n 30 --no-pager"
  die "service is '$STATE' — restore from this machine with: $ROLLBACK"
fi
"${SSH[@]}" "sudo journalctl -u $SERVICE -n 3 --no-pager | sed 's/^/  /'"

# --- verify -------------------------------------------------------------------
say "verifying from the outside"
FAILED=0
for path in / /app.js /styles.css /api/landings /api/realtime /api/alerts; do
  verify_http "$path" "${SITE}${path}" || FAILED=1
done
printf '  %-22s %s\n' "assets" "$(curl -sS --max-time 15 "${SITE}/" | grep -oE 'app\.js\?v=[0-9]+' | head -1)"

if [[ "$FAILED" == 1 ]]; then
  die "something is not answering 200 — restore from this machine with: $ROLLBACK"
fi

# Record success only after dependency installation, restart, and verification.
echo "$LOCAL_SHA" | "${SSH[@]}" "cat > /tmp/did-sha && sudo -u ubuntu cp /tmp/did-sha $APP_DIR/DEPLOYED_SHA"

# --- prune old backups --------------------------------------------------------
prune_local_backups "$BACKUP_DIR" "$SERVICE" "$KEEP_BACKUPS"

say "done — ${BRANCH} @ ${LOCAL_SHA:0:7} is live"
echo "  rollback from this machine: $ROLLBACK"
