ARG SOCIAL_NODE_IMAGE
FROM ${SOCIAL_NODE_IMAGE}
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules /opt/yarn* /usr/local/include /usr/local/share/man \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/corepack \
 && find / -xdev -type f \( -perm -4000 -o -perm -2000 \) -exec chmod a-s {} \;
# Public digest/version metadata must be readable by UID1000; it contains no credential.
COPY --chmod=0444 social-base-image.json /usr/local/share/pc-live-social/base-image.json
RUN mkdir -p /scratch && chown node:node /scratch && chmod 0700 /scratch
WORKDIR /app
COPY workers/live-social ./workers/live-social
USER node
VOLUME ["/scratch"]
ENV NODE_ENV=production TMPDIR=/scratch NODE_OPTIONS=--max-old-space-size=384
CMD ["node","workers/live-social/pull.mjs"]
