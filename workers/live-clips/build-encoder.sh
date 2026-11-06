#!/bin/sh
# Builder stage only: authenticate the official release before extraction.
set -eu
FFMPEG_VERSION=9.0.2
FFMPEG_SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
FFMPEG_RELEASE_KEY=FCF986EA15E6E293A5644F10B4322F04D67658D8
work=$(mktemp -d /tmp/pc-ffmpeg-build.XXXXXX)
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
./configure --prefix=/opt/renderer \
  --disable-everything --disable-autodetect --disable-network --disable-doc --disable-debug \
  --disable-shared --enable-static --disable-ffplay --enable-ffmpeg --enable-ffprobe \
  --enable-gpl --enable-libx264 --enable-libass --enable-libfreetype \
  --enable-libfontconfig --enable-libharfbuzz --enable-libfribidi \
  --disable-iconv --disable-bzlib --disable-lzma --disable-zlib --disable-hwaccels \
  --enable-protocol=file,pipe \
  --enable-demuxer=aac,hls,mpegts,mov,webvtt,image2,image2pipe,mjpeg \
  --enable-muxer=mp4,mov,image2,image2pipe,null,hls,mpegts,adts,latm,webvtt \
  --enable-decoder=h264,aac,aac_latm,mjpeg,webvtt,pcm_s16le,rawvideo,wrapped_avframe \
  --enable-encoder=libx264,aac,mjpeg,pcm_s16le,rawvideo,wrapped_avframe \
  --enable-parser=h264,aac,aac_latm,mjpeg,ac3 \
  --enable-bsf=aac_adtstoasc,h264_mp4toannexb,extract_extradata,null \
  --enable-indev=lavfi \
  --enable-filter=scale,pad,setsar,format,subtitles,drawtext,aresample,aformat,anull,anullsrc,null,trim,atrim,setpts,asetpts,fps,color,sine,testsrc2,buffer,buffersink,abuffer,abuffersink \
  --extra-cflags='-O2 -fstack-protector-strong -fPIC -D_FORTIFY_SOURCE=2' \
  --extra-ldflags='-Wl,-z,relro,-z,now -Wl,-z,stack-size=8388608 -pie'
make -j4
make install
mkdir -p /opt/renderer/share
cp "$work/source.sha256" /opt/renderer/share/ffmpeg-source.sha256
printf '%s\n' "$FFMPEG_RELEASE_KEY" > /opt/renderer/share/ffmpeg-release-key.txt
printf '%s\n' "$FFMPEG_VERSION" > /opt/renderer/share/ffmpeg-version.txt
cp config.h config_components.h /opt/renderer/share/
cp COPYING.GPLv2 LICENSE.md /opt/renderer/share/
apk info -v | sort > /opt/renderer/share/builder-packages.txt
for package in libass freetype fontconfig harfbuzz fribidi x264-libs font-dejavu ca-certificates; do
  version=$(awk -v prefix="$package-" 'index($0,prefix)==1 && substr($0,length(prefix)+1,1) ~ /^[0-9]$/ {print substr($0,length(prefix)+1)}' /opt/renderer/share/builder-packages.txt)
  test -n "$version"
  printf '%s=%s\n' "$package" "$version"
done > /opt/renderer/share/runtime-packages.lock
/opt/renderer/bin/ffmpeg -hide_banner -buildconf > /opt/renderer/share/ffmpeg-buildconf.txt 2>&1
sha256sum /opt/renderer/bin/ffmpeg /opt/renderer/bin/ffprobe > /opt/renderer/share/ffmpeg-binaries.sha256
