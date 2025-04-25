# syntax=docker/dockerfile:1

# Stage 1: Build TA-Lib C Library
FROM python:3.10-slim-bookworm as talib_builder
ARG TA_LIB_VERSION=0.4.0
ARG TA_LIB_URL=https://github.com/TA-Lib/ta-lib/archive/refs/tags/v${TA_LIB_VERSION}.tar.gz
ARG INSTALL_PREFIX=/usr/local

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential wget automake autoconf libtool && \
    rm -rf /var/lib/apt/lists/*

# Build TA-Lib
WORKDIR /tmp
RUN wget -q -O ta-lib-src.tar.gz ${TA_LIB_URL} && \
    tar -xzf ta-lib-src.tar.gz && \
    cd ta-lib-${TA_LIB_VERSION} && \
    ./configure --prefix=${INSTALL_PREFIX} && \
    make -j$(nproc) && \
    make install

# Stage 2: Final Image
FROM python:3.10-slim-bookworm
ARG INSTALL_PREFIX=/usr/local
WORKDIR /opt/render/project/src

# Install Node.js 20.x and Python build deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg build-essential cython3 && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy TA-Lib artifacts
COPY --from=talib_builder ${INSTALL_PREFIX}/lib/libta* ${INSTALL_PREFIX}/lib/
COPY --from=talib_builder ${INSTALL_PREFIX}/include/ta-lib ${INSTALL_PREFIX}/include/ta-lib
RUN ldconfig

# Set TA-Lib env vars
ENV LD_LIBRARY_PATH=${INSTALL_PREFIX}/lib
ENV TA_INCLUDE_PATH=${INSTALL_PREFIX}/include
ENV TA_LIBRARY_PATH=${INSTALL_PREFIX}/lib

# Install dependencies
COPY package.json package-lock.json ./
COPY requirements.txt ./
RUN npm install --production && \
    pip install --no-cache-dir --upgrade pip wheel setuptools && \
    pip install --no-cache-dir -r requirements.txt

# Verify installations
RUN python -c "import talib; print('TA-Lib OK:', talib.__version__)" && \
    node --version && npm --version

# Copy app code
COPY . .
EXPOSE 10000
CMD ["node", "server.js"]