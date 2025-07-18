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

RUN python3 -m pip install --upgrade pip && \
    python3 -m pip install -r requirements.txt --break-system-packages

COPY . .

RUN npm run build

FROM node:22-bookworm-slim

# Copy the built application from the builder stage
COPY --from=builder /app /app

# Copy executables to /usr/bin/ ensuring they are treated as files or creating a dir if it doesn't exist
COPY --from=builder /usr/bin/soffice /usr/bin/soffice
COPY --from=builder /usr/bin/gs /usr/bin/gs
COPY --from=builder /usr/bin/qpdf /usr/bin/qpdf
COPY --from=builder /usr/bin/python3 /usr/bin/python3
COPY --from=builder /usr/bin/pip3 /usr/bin/pip3

# Copy LibreOffice shared libraries directory
COPY --from=builder /usr/lib/libreoffice/ /usr/lib/libreoffice/

# Copy essential system shared libraries (e.g., for Cairo, JPEG, Pango, GIF, SVG)
# The key is to ensure the destination path ends with a '/' to denote a directory.
# If these files are going into /usr/lib/x86_64-linux-gnu/, that directory must exist,
# or you must copy them individually or as a group into a created directory.
# For simplicity and to ensure the destination is a directory, explicitly add '/'
# to the destination path.
COPY --from=builder \
    /usr/lib/x86_64-linux-gnu/libcairo.so.2 \
    /usr/lib/x86_64-linux-gnu/libjpeg.so.8 \
    /usr/lib/x86_64-linux-gnu/libpango-1.0.so.0 \
    /usr/lib/x86_64-linux-gnu/libpangocairo-1.0.so.0 \
    /usr/lib/x86_64-linux-gnu/libgdk_pixbuf-2.0.so.0 \
    /usr/lib/x86_64-linux-gnu/libgif.so.7 \
    /usr/lib/x86_64-linux-gnu/librsvg-2.so.2 \
    /usr/lib/x86_64-linux-gnu/ 

# Copy Python's dist-packages for runtime
COPY --from=builder /usr/local/lib/python3.11/dist-packages/ /usr/local/lib/python3.11/dist-packages/

WORKDIR /app

EXPOSE 3000

CMD ["npm", "start"]