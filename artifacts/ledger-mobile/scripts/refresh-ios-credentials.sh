#!/usr/bin/env bash
#
# Refresh EAS-managed iOS credentials for the production build profile and
# kick off a fresh build + TestFlight submit.
#
# RUN THIS ON YOUR MAC (eas-cli + Apple ID login are needed and macOS keychain
# is the only way through 2FA prompts at the moment).
#
# Why this script exists:
#   The build that failed on 2026-05-26 errored with:
#     - Provisioning profile "*[expo] com.ubuntu.life.ledger AppStore ..."
#       doesn't include signing certificate "iPhone Distribution: EAP
#       Financial Services Pty Ltd (42G8TCTL98)"
#   That message means EAS's stored Apple Distribution certificate no longer
#   matches the certificate referenced by the stored provisioning profile.
#   The fix is to regenerate the dist cert and let EAS rebind the profile
#   to it. This script walks that exact path non-interactively where it
#   can and prompts for Apple ID 2FA where it can't.
#
# Prereqs:
#   - macOS with Xcode + Command Line Tools installed
#   - Node 20+ and pnpm
#   - eas-cli installed globally:  npm i -g eas-cli
#   - Logged into your Expo account: `eas whoami` should print "elandref"
#
# Usage:
#   cd artifacts/ledger-mobile
#   ./scripts/refresh-ios-credentials.sh
#
set -euo pipefail

PROFILE="production"

cd "$(dirname "$0")/.."

echo "==> Confirming eas-cli is logged in..."
if ! eas whoami >/dev/null 2>&1; then
    echo "    Not logged in. Running 'eas login' now."
    eas login
fi
echo "    Logged in as: $(eas whoami)"

echo ""
echo "==> Removing the stale Distribution Certificate from EAS."
echo "    This is the certificate whose mismatch was causing the build to fail."
echo "    Choose: iOS  →  $PROFILE  →  Distribution Certificate  →  Remove."
echo "    You will be prompted; pick the existing cert and confirm removal."
echo ""
echo "    (Removing the cert auto-invalidates all profiles bound to it, which"
echo "     is what we want — EAS will regenerate everything fresh on next"
echo "     build.)"
echo ""
read -rp "Press Enter to open 'eas credentials' now..."
eas credentials --platform ios

echo ""
echo "==> Now kicking off a fresh production build."
echo "    When prompted to generate a new Distribution Certificate and"
echo "    Provisioning Profile, choose 'Yes' for both."
echo "    You'll be asked for your Apple ID password and 2FA code."
echo ""

eas build \
    --platform ios \
    --profile "$PROFILE" \
    --auto-submit \
    --clear-cache \
    --message "Apple Sign In migration + credential refresh"

echo ""
echo "==> Build queued. Watch progress at the URL printed above, or run:"
echo "       eas build:list --platform ios --limit 1"
echo ""
echo "==> Once the build finishes and submits, allow ~10-30 min for Apple"
echo "    to process before it shows up in TestFlight."
