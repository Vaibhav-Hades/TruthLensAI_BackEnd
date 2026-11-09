# Production image for Render (Linux). Includes the two binaries the video pipeline shells out to:
#   yt-dlp  - subtitle + audio download      ffmpeg - audio processing before Whisper
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Standalone yt-dlp binary (no Python needed). Pin a version for reproducible builds if you prefer:
#   .../releases/download/<tag>/yt-dlp_linux
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && yt-dlp --version && ffmpeg -version | head -1

ENV NODE_ENV=production \
    YTDLP_JS_RUNTIME=node

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Render injects PORT; server.js reads it.
EXPOSE 10000
CMD ["node", "server.js"]
