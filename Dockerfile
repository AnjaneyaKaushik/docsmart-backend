FROM node:22-bookworm-slim AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-draw \
    libreoffice-common \
    build-essential \
    libcairo2-dev \
    libjpeg-dev \
    libpango1.0-dev \
    libgif-dev \
    librsvg2-dev \
    ghostscript \
    python3 \
    python3-pip \
    qpdf && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY requirements.txt .
RUN pip3 install -r requirements.txt

COPY . .

RUN npm run build

FROM node:22-bookworm-slim

COPY --from=builder /app /app

COPY --from=builder /usr/bin/soffice /usr/bin/soffice
COPY --from=builder /usr/lib/libreoffice/ /usr/lib/libreoffice/
COPY --from=builder /usr/lib/x86_64-linux-gnu/libcairo.so.2 /usr/lib/x86_64-linux-gnu/
COPY --from=builder /usr/lib/x86_64-linux-gnu/libjpeg.so.8 /usr/lib/x86_64-linux-gnu/
COPY --from=builder /usr/lib/x86_64-linux-gnu/libpango-1.0.so.0 /usr/lib/x86_64-linux-gnu/
COPY --from=builder /usr/lib/x86_64-linux-gnu/libpangocairo-1.0.so.0 /usr/lib/x86_64-linux-gnu/
COPY --from=builder /usr/lib/x86_64-linux-gnu/libgdk_pixbuf-2.0.so.0 /usr/lib/x86_64-linux-gnu/
COPY --from=builder /usr/lib/x86_64-linux-gnu/libgif.so.7 /usr/lib/x86_64-linux-gnu/
COPY --from=builder /usr/lib/x86_64-linux-gnu/librsvg-2.so.2 /usr/lib/x86_64-linux-gnu/
COPY --from=builder /usr/bin/gs /usr/bin/
COPY --from=builder /usr/bin/qpdf /usr/bin/

WORKDIR /app

EXPOSE 3000

CMD ["npm", "start"]