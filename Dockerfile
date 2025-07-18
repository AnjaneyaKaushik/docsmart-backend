FROM node:22-bookworm-slim AS builder

# Install system dependencies
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
    qpdf \
    libgl1-mesa-glx \
    libhdf5-dev \
    libxml2-dev \
    libxslt1-dev \
    zlib1g-dev \
    libffi-dev \
    libssl-dev \
    libwebp-dev \
    libtiff-dev \
    libopenjp2-7-dev \
    libatlas-base-dev \
    gfortran \
    libfreetype6-dev \
    && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY requirements.txt .

RUN python3 -m pip install --upgrade pip && \
    python3 -m pip install -r requirements.txt --break-system-packages

COPY . .

RUN npm run build

FROM node:22-bookworm-slim

COPY --from=builder /app /app

# Copy executables to /usr/bin/
COPY --from=builder /usr/bin/soffice /usr/bin/soffice
COPY --from=builder /usr/bin/gs /usr/bin/gs
COPY --from=builder /usr/bin/qpdf /usr/bin/qpdf
COPY --from=builder /usr/bin/python3 /usr/bin/python3
COPY --from=builder /usr/bin/pip3 /usr/bin/pip3

# Copy LibreOffice shared libraries directory
COPY --from=builder /usr/lib/libreoffice/ /usr/lib/libreoffice/

# --- FIX FOR COPY ERROR START ---
# Explicitly create the target directory if it might not exist or if Docker is being particular.
# Then perform the COPY operation. This makes the destination clearly a directory.
RUN mkdir -p /usr/lib/x86_64-linux-gnu/

# Copy essential system shared libraries (e.g., for Cairo, JPEG, Pango, GIF, SVG, GL)
COPY --from=builder \
    /usr/lib/x86_64-linux-gnu/libcairo.so.2 \
    /usr/lib/x86_64-linux-gnu/libjpeg.so.8 \
    /usr/lib/x86_64-linux-gnu/libpango-1.0.so.0 \
    /usr/lib/x86_64-linux-gnu/libpangocairo-1.0.so.0 \
    /usr/lib/x86_64-linux-gnu/libgdk_pixbuf-2.0.so.0 \
    /usr/lib/x86_64-linux-gnu/libgif.so.7 \
    /usr/lib/x86_64-linux-gnu/librsvg-2.so.2 \
    /usr/lib/x86_64-linux-gnu/libglx_mesa.so.0 \
    /usr/lib/x86_64-linux-gnu/libGL.so.1 \
    /usr/lib/x86_64-linux-gnu/libfreetype.so.6 \
    /usr/lib/x86_64-linux-gnu/libxml2.so.2 \
    /usr/lib/x86_64-linux-gnu/libxslt.so.1 \
    /usr/lib/x86_64-linux-gnu/libffi.so.8 \
    /usr/lib/x86_64-linux-gnu/libssl.so.3 \
    /usr/lib/x86_64-linux-gnu/libwebp.so.7 \
    /usr/lib/x86_64-linux-gnu/libtiff.so.6 \
    /usr/lib/x86_64-linux-gnu/libopenjp2.so.7 \
    /usr/lib/x86_64-linux-gnu/libhdf5.so.200 \
    /usr/lib/x86_64-linux-gnu/libgfortran.so.5 \
    /usr/lib/x86_64-linux-gnu/libatlas.so.3 \
    /usr/lib/x86_64-linux-gnu/ 
# --- FIX FOR COPY END ---

# Copy Python's dist-packages for runtime
COPY --from=builder /usr/local/lib/python3.11/dist-packages/ /usr/local/lib/python3.11/dist-packages/

WORKDIR /app

EXPOSE 3000

CMD ["npm", "start"]