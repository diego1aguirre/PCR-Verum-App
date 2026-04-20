# node:20-slim strips too many system libraries for LibreOffice to run.
# Use the full Bookworm image so all shared-library deps are present.
FROM node:20-bookworm

# Install LibreOffice and locale support.
# Drop --no-install-recommends so apt pulls in every required shared lib.
RUN apt-get update && apt-get install -y \
    libreoffice \
    libreoffice-writer \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-crosextra-carlito \
    fonts-crosextra-caladea \
    locales \
    && locale-gen en_US.UTF-8 \
    && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

WORKDIR /app

# Install dependencies (layer cached until package.json changes)
COPY package*.json ./
RUN npm ci

# Declare build-time env vars so Vite can bake them into the bundle.
# Railway passes all service env vars as Docker build args automatically
# when they are declared with ARG here.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Copy source and build frontend
COPY . .
RUN npm run build

CMD ["node", "server.js"]
