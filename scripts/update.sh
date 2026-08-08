#!/usr/bin/env bash
# Update submodules (workflows and/or history)
# Usage: ./scripts/update.sh [--workflows] [--history] [--project NAME]
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENGINEERING_ROOT="$(dirname "$SCRIPT_DIR")"
PROJECT_NAME="${PROJECT_NAME:-$(basename "$(dirname "$ENGINEERING_ROOT")")}"
UPDATE_WORKFLOWS=false; UPDATE_HISTORY=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --workflows) UPDATE_WORKFLOWS=true; shift ;;
        --history) UPDATE_HISTORY=true; shift ;;
        --project) PROJECT_NAME="$2"; shift 2 ;;
        *) shift ;;
    esac
done
[ "$UPDATE_WORKFLOWS" = false ] && [ "$UPDATE_HISTORY" = false ] && { UPDATE_WORKFLOWS=true; UPDATE_HISTORY=true; }
if [ "$UPDATE_WORKFLOWS" = true ] && [ -d "$ENGINEERING_ROOT/workflows" ]; then
    echo "=== Updating workflows ===" && cd "$ENGINEERING_ROOT/workflows"
    git fetch origin --quiet 2>/dev/null || true
    git checkout workflows --quiet 2>/dev/null || true
    git pull origin workflows --quiet && echo "[PASS] workflows: $(git rev-parse --short HEAD)"
fi
if [ "$UPDATE_HISTORY" = true ] && [ -d "$ENGINEERING_ROOT/history" ]; then
    echo "=== Updating history ===" && cd "$ENGINEERING_ROOT/history"
    git fetch origin "$PROJECT_NAME" && git checkout "$PROJECT_NAME" 2>/dev/null || true
    git pull origin "$PROJECT_NAME" && echo "[PASS] history: $(git rev-parse --short HEAD)"
fi
