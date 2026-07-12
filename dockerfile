FROM node:20-slim AS base

RUN apt-get update && apt-get install -y \
    ffmpeg \
    fontconfig \
    fonts-dejavu \
    python3 \
    python3-pip \
    python3-numpy \
    python3-opencv \
    ca-certificates \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    wget \
    --no-install-recommends \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

# Librosa (beat_detection.py) — pip, not apt, since Debian doesn't package it.
RUN pip3 install --no-cache-dir --break-system-packages librosa

RUN mkdir -p /usr/share/fonts/truetype/montserrat \
    && wget -q -O /usr/share/fonts/truetype/montserrat/Montserrat-VariableFont_wght.ttf \
       "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf" \
    && wget -q -O /usr/share/fonts/truetype/montserrat/Montserrat-Italic-VariableFont_wght.ttf \
       "https://github.com/google/fonts/raw/main/ofl/montserrat/Montserrat-Italic%5Bwght%5D.ttf" \
    && fc-cache -fv

WORKDIR /app

# ─── Dependencies ─────────────────────────────────────────────────────────────
FROM base AS deps

COPY package*.json ./
RUN npm ci

# Download Remotion's chrome-headless-shell into node_modules/.remotion
RUN npx remotion browser ensure

# ─── Builder — compile TypeScript ─────────────────────────────────────────────
FROM deps AS builder

# Copy tsconfig here so changes bust builder cache without re-running npm ci
COPY tsconfig.json ./
COPY . .
RUN npx tsc --outDir dist

# ─── Production ───────────────────────────────────────────────────────────────
FROM base AS production

# node_modules including .remotion chrome binary
COPY --from=deps /app/node_modules ./node_modules

# Compiled JS
COPY --from=builder /app/dist ./dist

# Remotion TSX source — bundle() reads this at runtime, cannot be pre-compiled
COPY remotion/ ./remotion/

# Face detection script
COPY face_center.py ./
COPY detect_logo.py ./

# Create runtime dirs
RUN mkdir -p /tmp/jobs /tmp/render-jobs /tmp/renders /tmp/music && \
    chown -R node:node /tmp/jobs /tmp/render-jobs /tmp/renders /tmp/music /app

ENV NODE_ENV=production
ENV CLIP_JOBS_DIR=/tmp/jobs
ENV RENDER_JOBS_DIR=/tmp/render-jobs
ENV OUTPUT_DIR=/tmp/renders
ENV MUSIC_OUTPUT_DIR=/tmp/music

USER node

EXPOSE 9000

CMD ["node", "dist/opus.js"]