#!/bin/sh
# Builder stage only: authenticate the official release before extraction.
set -eu
FFMPEG_VERSION=9.0.2
FFMPEG_SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
FFMPEG_RELEASE_KEY=FCF986EA15E6E293A5644F10B4322F04D67658D8
work=$(mktemp -d /tmp/pc-caption-ffmpeg-build.XXXXXX)
trap 'rm -rf "$work"' EXIT
mkdir -m 700 "$work/keyring" "$work/source"
cd "$work"
fetch() {
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 15 --max-time 60 --retry 3 --retry-all-errors --retry-delay 2 --retry-max-time 180 \
    --max-filesize 33554432 "$1" --output "$2"
}
fetch https://ffmpeg.org/ffmpeg-devel.asc release-key.asc
fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" source.tar.xz
fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz.asc" source.tar.xz.asc
gpg --batch --homedir "$work/keyring" --import release-key.asc
test "$(gpg --batch --homedir "$work/keyring" --with-colons --fingerprint | awk -F: '$1 == "fpr" {print $10; exit}')" = "$FFMPEG_RELEASE_KEY"
gpg --batch --homedir "$work/keyring" --status-fd 3 --verify source.tar.xz.asc source.tar.xz 3>signature.status
awk -v key="$FFMPEG_RELEASE_KEY" '$1 == "[GNUPG:]" && $2 == "VALIDSIG" && $3 == key {valid=1} END {exit !valid}' signature.status
# Require both the authentic signature and exact expected release bytes. The
# first actual build verifies this expected digest against the signed source.
printf '%s  source.tar.xz\n' "$FFMPEG_SHA256" | sha256sum -c -
sha256sum source.tar.xz > source.sha256
tar --extract --xz --file source.tar.xz --directory source --strip-components=1 --no-same-owner --no-same-permissions
test "$(cat source/VERSION)" = "$FFMPEG_VERSION"
cd source
# FFmpeg CLI selects the listed basic video graph filters even for audio-only
# operations. No video codec or network protocol is enabled.
./configure --prefix=/opt/transcription \
  --disable-everything --disable-autodetect --disable-network --disable-doc --disable-debug \
  --disable-shared --enable-static --disable-ffplay --enable-ffmpeg --enable-ffprobe \
  --disable-avdevice --disable-swscale --disable-gpl --disable-iconv --disable-bzlib --disable-lzma --disable-zlib --disable-hwaccels \
  --enable-protocol=file,pipe \
  --enable-demuxer=mov,flac \
  --enable-muxer=flac,null \
  --enable-decoder=aac,flac \
  --enable-encoder=flac,pcm_s16le \
  --enable-parser=aac,flac \
  --enable-filter=aresample,aformat,anull,atrim,asetpts,abuffer,abuffersink,crop,format,hflip,null,rotate,transpose,trim,vflip \
  --extra-cflags='-O2 -fstack-protector-strong -fPIC -D_FORTIFY_SOURCE=2' \
  --extra-ldflags='-Wl,-z,relro,-z,now -pie'
make -j4
make install
mkdir -p /opt/transcription/share
cp "$work/source.sha256" /opt/transcription/share/ffmpeg-source.sha256
printf '%s\n' "$FFMPEG_RELEASE_KEY" > /opt/transcription/share/ffmpeg-release-key.txt
printf '%s\n' "$FFMPEG_VERSION" > /opt/transcription/share/ffmpeg-version.txt
cp config.h config_components.h /opt/transcription/share/
cp COPYING.LGPLv2.1 LICENSE.md /opt/transcription/share/
apk info -v | sort > /opt/transcription/share/builder-packages.txt
version=$(awk '/^ca-certificates-[0-9]/ {sub(/^ca-certificates-/, ""); print}' /opt/transcription/share/builder-packages.txt)
test -n "$version"
printf 'ca-certificates=%s\n' "$version" > /opt/transcription/share/runtime-packages.lock
/opt/transcription/bin/ffmpeg -hide_banner -buildconf > /opt/transcription/share/ffmpeg-buildconf.txt 2>&1
sha256sum /opt/transcription/bin/ffmpeg /opt/transcription/bin/ffprobe > /opt/transcription/share/ffmpeg-binaries.sha256
