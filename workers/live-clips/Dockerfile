ARG RENDERER_NODE_IMAGE
FROM ${RENDERER_NODE_IMAGE} AS encoder
RUN apk upgrade --no-cache && apk add --no-cache \
 build-base nasm pkgconf curl gnupg xz tar \
 libass-dev freetype-dev fontconfig-dev harfbuzz-dev fribidi-dev x264-dev font-dejavu ca-certificates
COPY workers/live-clips/build-encoder.sh /build-encoder.sh
RUN sh /build-encoder.sh

FROM ${RENDERER_NODE_IMAGE} AS runtime
COPY --from=encoder /opt/renderer/share/runtime-packages.lock /tmp/runtime-packages.lock
RUN apk upgrade --no-cache && xargs apk add --no-cache < /tmp/runtime-packages.lock \
 && rm -rf /usr/local/lib/node_modules /opt/yarn* /usr/local/include /usr/local/share/man \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/corepack \
 && find / -xdev -type f \( -perm -4000 -o -perm -2000 \) -exec chmod a-s {} \; \
 && rm /tmp/runtime-packages.lock
COPY --from=encoder /opt/renderer/bin/ffmpeg /opt/renderer/bin/ffprobe /usr/local/bin/
COPY --from=encoder /opt/renderer/share/ /usr/local/share/pc-live-clips/
COPY --chmod=0444 renderer-base-image.json /usr/local/share/pc-live-clips/base-image.json
RUN mkdir -p /scratch && chown node:node /scratch && chmod 0700 /scratch
WORKDIR /app
COPY workers/live-clips ./workers/live-clips
COPY workers/media-renditions/transcode.mjs ./workers/media-renditions/transcode.mjs
COPY workers/media-renditions/config.mjs ./workers/media-renditions/config.mjs
RUN node workers/live-clips/encoder-policy.mjs --write-inventory
USER node
VOLUME ["/scratch"]
ENV NODE_ENV=production TMPDIR=/scratch NODE_OPTIONS=--max-old-space-size=256
CMD ["node","workers/live-clips/pull.mjs"]
