#!/usr/bin/env bash
set -euo pipefail

# Only package prerequisites run here. Browser, media and provider acceptance
# still run in their existing workflow steps, with their existing hard limits.
runtime_mode="${1:-}"
case "$runtime_mode" in
  media) test "$#" -eq 1 ;;
  browser|browser-media) test "$#" -eq 2 ;;
  *) printf '%s\n' 'Use media, browser <Playwright CLI>, or browser-media <Playwright CLI>.' >&2; exit 2 ;;
esac
if [[ "${CI:-}" != true || "$(uname -s)" != Linux || "$(dpkg --print-architecture)" != amd64 ]]; then
  printf '%s\n' 'Use only the disposable Ubuntu x86_64 CI runner.' >&2
  exit 2
fi
source /etc/os-release
if [[ "${ID:-}" != ubuntu || "${VERSION_CODENAME:-}" != noble ]]; then
  printf '%s\n' 'Review test runtime setup for a different OS release.' >&2
  exit 2
fi

verify_media() {
  command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null &&
    ffmpeg -version >/dev/null 2>&1 && ffprobe -version >/dev/null 2>&1
}
runtime_packages=()
if [[ "$runtime_mode" != browser ]] && ! verify_media; then
  runtime_packages+=(ffmpeg:amd64)
fi
if [[ "$runtime_mode" == media && "${#runtime_packages[@]}" -eq 0 ]]; then
  printf '%s\n' 'ffmpeg and ffprobe are ready.'
  exit 0
fi
if [[ "$runtime_mode" != media ]]; then
  runtime_node="$(command -v node)"
  runtime_cli="$(realpath "${2:?Pass the installed Playwright CLI}")"
  [[ "$runtime_node" == /* && "$runtime_cli" == /* && -f "$runtime_cli" ]]
  if ! command -v unzip >/dev/null || ! unzip -v >/dev/null 2>&1; then
    runtime_packages+=(unzip:amd64)
  fi
fi

# The c69a browser setup exhausted its 15-minute job limit downloading ffmpeg
# from the Azure mirror. Use the same signed Ubuntu suites via official HTTPS
# archives for this invocation. Do not rewrite the runner's system sources.
runtime_sources="$(mktemp -d "${RUNNER_TEMP:-/tmp}/platinum-linux-test.XXXXXX")"
trap 'rm -rf "$runtime_sources"' EXIT
chmod 755 "$runtime_sources"
test -s /usr/share/keyrings/ubuntu-archive-keyring.gpg
cat > "$runtime_sources/ubuntu.list" <<'SOURCES'
deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://archive.ubuntu.com/ubuntu noble main restricted universe multiverse
deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://archive.ubuntu.com/ubuntu noble-updates main restricted universe multiverse
deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://security.ubuntu.com/ubuntu noble-security main restricted universe multiverse
SOURCES
runtime_apt_config="$runtime_sources/apt.conf"
cat > "$runtime_apt_config" <<CONFIG
Dir::Etc::sourcelist "$runtime_sources/ubuntu.list";
Dir::Etc::sourceparts "-";
Acquire::Retries "1";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
APT::Update::Error-Mode "any";
CONFIG
if [[ "${#runtime_packages[@]}" -gt 0 ]]; then
  sudo env "APT_CONFIG=$runtime_apt_config" apt-get update --error-on=any
  sudo env "APT_CONFIG=$runtime_apt_config" apt-get install --yes --no-install-recommends "${runtime_packages[@]}"
fi
if [[ "$runtime_mode" != media ]]; then
  # Running the absolute Node/CLI paths as root lets Playwright's child apt-get
  # inherit the isolated config. Keep Playwright's complete Chromium library list.
  sudo env "APT_CONFIG=$runtime_apt_config" "$runtime_node" "$runtime_cli" install-deps chromium
  unzip -v >/dev/null
fi
if [[ "$runtime_mode" != browser ]]; then
  verify_media
  printf '%s\n' 'ffmpeg and ffprobe are ready.'
fi
