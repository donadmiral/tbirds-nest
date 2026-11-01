#!/usr/bin/env bash
set -euo pipefail

# Called inside the workflow's hard five-minute bound. No emulator or encoder
# acceptance can pass from this prerequisite check alone.
if [[ "${CI:-}" != true || "$(uname -s)" != Linux || "$(dpkg --print-architecture)" != amd64 ]]; then
  printf '%s\n' 'Use only the disposable Ubuntu x86_64 encoder runner.' >&2
  exit 2
fi
# The package names, suites and archive key below are deliberately specific.
# Do not silently apply them to another distribution or release.
source /etc/os-release
if [[ "${ID:-}" != ubuntu || "${VERSION_CODENAME:-}" != noble ]]; then
  printf '%s\n' 'Review encoder host setup for a different OS release.' >&2
  exit 2
fi

verify_pulse() {
  [[ "$(dpkg-query -W -f='${db:Status-Status}' libpulse0:amd64 2>/dev/null)" == installed ]] || return 1
  python3 -c "import ctypes; ctypes.CDLL('libpulse.so.0'); print('libpulse.so.0 loads successfully')"
}
if verify_pulse; then
  dpkg-query -W -f='${binary:Package} ${Version}\n' libpulse0:amd64
  exit 0
fi

# The retained same-run build log shows the Azure mirror stalling before the
# ordinary Ubuntu archive succeeds. Use official HTTPS repositories directly
# for this one prerequisite, retaining Ubuntu's normal signed-package checks.
# Existing system source configuration is never rewritten.
encoder_host_sources="$(mktemp -d "${RUNNER_TEMP:-/tmp}/platinum-encoder-host.XXXXXX")"
trap 'rm -rf "$encoder_host_sources"' EXIT
chmod 755 "$encoder_host_sources"
test -s /usr/share/keyrings/ubuntu-archive-keyring.gpg
cat > "$encoder_host_sources/ubuntu.list" <<'SOURCES'
deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://archive.ubuntu.com/ubuntu noble main
deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://archive.ubuntu.com/ubuntu noble-updates main
deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://security.ubuntu.com/ubuntu noble-security main
SOURCES
encoder_apt_options=(
  -o "Dir::Etc::sourcelist=$encoder_host_sources/ubuntu.list"
  -o 'Dir::Etc::sourceparts=-'
  -o 'Acquire::Retries=1'
  -o 'Acquire::http::Timeout=20'
  -o 'Acquire::https::Timeout=20'
)
sudo apt-get "${encoder_apt_options[@]}" update --error-on=any
sudo apt-get "${encoder_apt_options[@]}" install --yes --no-install-recommends libpulse0:amd64
verify_pulse
dpkg-query -W -f='${binary:Package} ${Version}\n' libpulse0:amd64
