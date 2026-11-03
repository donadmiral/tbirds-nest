ARG ASR_NODE_IMAGE
FROM ${ASR_NODE_IMAGE} AS encoder
RUN apk upgrade --no-cache && apk add --no-cache build-base nasm pkgconf curl gnupg xz tar ca-certificates
COPY workers/live-transcription/build-encoder.sh /build-encoder.sh
RUN sh /build-encoder.sh

FROM ${ASR_NODE_IMAGE} AS dependencies
WORKDIR /app/workers/live-transcription
COPY workers/live-transcription/package.json workers/live-transcription/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM ${ASR_NODE_IMAGE} AS runtime
COPY --from=encoder /opt/transcription/share/runtime-packages.lock /tmp/runtime-packages.lock
RUN apk upgrade --no-cache && xargs apk add --no-cache < /tmp/runtime-packages.lock \
 && rm -rf /usr/local/lib/node_modules /opt/yarn* /usr/local/include /usr/local/share/man \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/corepack \
 && find / -xdev -type f \( -perm -4000 -o -perm -2000 \) -exec chmod a-s {} \; \
 && rm /tmp/runtime-packages.lock
COPY --from=encoder /opt/transcription/bin/ffmpeg /opt/transcription/bin/ffprobe /usr/local/bin/
COPY --from=encoder /opt/transcription/share/ /usr/local/share/pc-live-transcription/
COPY --chmod=0444 transcription-base-image.json /usr/local/share/pc-live-transcription/base-image.json
COPY --from=dependencies /app/workers/live-transcription/node_modules /app/workers/live-transcription/node_modules
RUN mkdir -p /scratch && chown node:node /scratch && chmod 0700 /scratch
WORKDIR /app
COPY workers/live-transcription/*.mjs ./workers/live-transcription/
COPY workers/live-transcription/test ./workers/live-transcription/test
RUN node workers/live-transcription/encoder-policy.mjs --write-inventory
USER node
VOLUME ["/scratch"]
ENV NODE_ENV=production TMPDIR=/scratch NODE_OPTIONS=--max-old-space-size=256
CMD ["node", "workers/live-transcription/pull.mjs"]
