# Start from the official Puppeteer image which already has Node + Chromium + all X11/headless deps
FROM ghcr.io/puppeteer/puppeteer:21.6.1

# Switch to root to install FFmpeg
USER root

# Remove Google Chrome apt sources because they often have missing/expired GPG keys
# which breaks `apt-get update`. We don't need to update Chrome, just need ffmpeg.
RUN rm -f /etc/apt/sources.list.d/google-chrome.list /etc/apt/sources.list.d/google.list

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Switch back to the non-root pptruser provided by the base image
USER pptruser

WORKDIR /app

# Copy package files
COPY --chown=pptruser:pptruser package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY --chown=pptruser:pptruser . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm prune --omit=dev

# Create required directories with correct permissions
RUN mkdir -p /files/audio /files/video /files/images /files/temp /files/output /files/binary /files/logs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --spider -q http://localhost:3000/health || exit 1

# Start the server
CMD ["npm", "start"]
