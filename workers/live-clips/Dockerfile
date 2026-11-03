FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY workers/live-clips ./workers/live-clips
COPY workers/media-renditions/transcode.mjs ./workers/media-renditions/transcode.mjs
COPY workers/media-renditions/config.mjs ./workers/media-renditions/config.mjs
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node","workers/live-clips/server.mjs"]
