#!/usr/bin/env bash

set -euo pipefail

if [[ -n "${OCTO_BROWSER_BROWSER_PATH:-}" ]]; then
  if [[ -x "${OCTO_BROWSER_BROWSER_PATH}" ]]; then
    printf '%s\n' "${OCTO_BROWSER_BROWSER_PATH}"
    exit 0
  fi
  printf 'Configured browser path is not executable: %s\n' "${OCTO_BROWSER_BROWSER_PATH}" >&2
  exit 1
fi

declare -a candidates=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  "/usr/bin/google-chrome"
  "/usr/bin/google-chrome-stable"
  "/usr/bin/chromium"
  "/usr/bin/chromium-browser"
  "/snap/bin/chromium"
)

for candidate in "${candidates[@]}"; do
  if [[ -x "${candidate}" ]]; then
    printf '%s\n' "${candidate}"
    exit 0
  fi
done

declare -a path_commands=(
  "google-chrome"
  "google-chrome-stable"
  "chromium"
  "chromium-browser"
  "chrome"
)

for command_name in "${path_commands[@]}"; do
  if command -v "${command_name}" >/dev/null 2>&1; then
    command -v "${command_name}"
    exit 0
  fi
done

printf '%s\n' "Could not find a local Chrome/Chromium executable. Set OCTO_BROWSER_BROWSER_PATH or pass an explicit browser path." >&2
exit 1
