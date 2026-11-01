#!/usr/bin/env bash
set -euo pipefail

# Pin the exact official browser used by the media/lifecycle verification.
# The Playwright 1.63 bundled 153 archive no longer produced a valid ZIP when
# checked on 2026-11-01. Do not silently substitute a different browser version.
platinum_chrome_root="${1:?Pass an absolute browser installation directory}"
case "$platinum_chrome_root" in /*) ;; *) printf '%s\n' 'Browser directory must be absolute.' >&2; exit 1 ;; esac
platinum_chrome_version='156.0.8078.80'
platinum_chrome_sha='b711c720f774be355197f32edf37e0651418ba036d92446ee2da19ac017540a7'
platinum_chrome_archive="$platinum_chrome_root/chrome-linux64.zip"
mkdir -p "$platinum_chrome_root"
curl --fail --location --retry 2 --connect-timeout 20 --max-time 180 \
  --output "$platinum_chrome_archive" \
  "https://storage.googleapis.com/chrome-for-testing-public/$platinum_chrome_version/linux64/chrome-linux64.zip"
printf '%s  %s\n' "$platinum_chrome_sha" "$platinum_chrome_archive" | sha256sum --check --status
unzip -q -o "$platinum_chrome_archive" -d "$platinum_chrome_root"
platinum_chrome_executable="$platinum_chrome_root/chrome-linux64/chrome"
platinum_chrome_actual="$("$platinum_chrome_executable" --version)"
test "$platinum_chrome_actual" = "Google Chrome for Testing $platinum_chrome_version"
printf '%s\n' "$platinum_chrome_actual"
if test -n "${GITHUB_ENV:-}"; then
  printf 'PLATINUM_CHROMIUM=%s\nSTORY_QA_CHROME=%s\n' "$platinum_chrome_executable" "$platinum_chrome_executable" >> "$GITHUB_ENV"
fi
