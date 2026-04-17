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

# Copy source and build frontend
COPY . .
RUN npm run build

EXPOSE 4000

CMD ["node", "server.js"]
