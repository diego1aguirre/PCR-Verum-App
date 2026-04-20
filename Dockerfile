FROM node:20-slim

# Install LibreOffice via apt — ends up at /usr/bin/soffice
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice \
    libreoffice-writer \
    fonts-liberation \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

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
