FROM node:22-bookworm-slim AS builder

# Install system dependencies
# Ensure all apt-get packages are on the same line or properly continued with '\'
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
    python3-venv \
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

# Create a virtual environment and install Python dependencies within it
RUN python3 -m venv /opt/venv && \
    . /opt/venv/bin/activate && \
    pip install --upgrade pip && \
    pip install -r requirements.txt

COPY . .

RUN npm run build

FROM node:22-bookworm-slim

# Create the target directory before copying files into it
RUN mkdir -p /usr/lib/x86_64-linux-gnu/

COPY --from=builder /app /app

COPY --from=builder /opt/venv /opt/venv

# Copy executables
COPY --from=builder /usr/bin/soffice /usr/bin/soffice
COPY --from=builder /usr/bin/gs /usr/bin/gs
COPY --from=builder /usr/bin/qpdf /usr/bin/qpdf

# Copy LibreOffice shared libraries directory
COPY --from=builder /usr/lib/libreoffice/ /usr/lib/libreoffice/

# Copy essential system shared libraries
# The destination is clearly a directory due to the pre-creation (mkdir -p)
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

# Set the PATH to include the virtual environment's bin directory
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

EXPOSE 3000

CMD ["npm", "start"]