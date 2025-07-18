FROM node:22-bookworm-slim AS builder

# Install system dependencies in the builder stage
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

# ---
# Stage 2: Production image (leaner, contains only what's needed to run)
# We will reinstall runtime dependencies here to ensure they are properly linked.
FROM node:22-bookworm-slim

# Copy the built application from the builder stage
COPY --from=builder /app /app

# Copy the entire virtual environment from the builder stage
COPY --from=builder /opt/venv /opt/venv

# Re-install *runtime* versions of necessary system libraries directly in the final image.
# This is more robust than copying individual .so files, as apt handles dependencies.
# Note: Package names here are the *runtime* equivalents of the -dev packages from stage 1.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-draw \
    libreoffice-common \
    qpdf \
    libgl1-mesa-glx \
    libhdf5-200 \
    libxml2 \
    libxslt1.1 \
    zlib1g \
    libffi8 \
    libssl3 \
    libwebp7 \
    libtiff6 \
    libopenjp2-7 \
    libatlas3-base \
    libgfortran5 \
    libfreetype6 \
    # You might need to add other core runtime libraries here if they were specifically listed
    # in your previous extensive .so copy list and are not brought in by the above.
    # For example, if libcairo.so.2 isn't part of any above, you'd need 'libcairo2' package.
    # However, common libs like libcairo2, libjpeg8, libpango1.0 etc. are usually
    # pulled in as dependencies by LibreOffice itself or the base image.
    && \
    rm -rf /var/lib/apt/lists/*

# Set the PATH to include the virtual environment's bin directory
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

EXPOSE 3000

CMD ["npm", "start"]