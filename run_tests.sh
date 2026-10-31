#!/usr/bin/env bash
# AgentDesk Test Suite: Unit Tests + Automated Browser E2E Tests
set -euo pipefail

cd "$(dirname "$0")"

echo "============================================================"
echo "⚡ AGENTDESK TEST PIPELINE: UNIT + BROWSER E2E TESTS"
echo "============================================================"

python3 -m unittest discover tests -v

echo ""
echo "============================================================"
echo "✅ ALL UNIT & E2E BROWSER TESTS PASSED!"
echo "============================================================"
