# syntax=docker/dockerfile:1

# Stage 1: Build TA-Lib C Library
FROM python:3.10-slim-bookworm as talib_builder
ARG TA_LIB_VERSION=0.4.0
ARG TA_LIB_URL=http://prdownloads.sourceforge.net/ta-lib/ta-lib-${TA_LIB_VERSION}-src.tar.gz
ARG INSTALL_PREFIX=/usr/local

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential wget make && \
    rm -rf /var/lib/apt/lists/*

# Download, build, and install TA-Lib
WORKDIR /tmp
RUN wget -q -O ta-lib-src.tar.gz ${TA_LIB_URL} && \
    tar -xzf ta-lib-src.tar.gz && \
    cd ta-lib && \
    ./configure --prefix=${INSTALL_PREFIX} && \
    make && \
    make install

# Stage 2: Final image
FROM python:3.10-slim-bookworm
ARG INSTALL_PREFIX=/usr/local
WORKDIR /opt/render/project/src

# Install build tools, wget, Node.js
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg build-essential make cython3 wget && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    NODE_MAJOR=20 && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy TA-Lib from builder stage
COPY --from=talib_builder ${INSTALL_PREFIX}/lib/libta* ${INSTALL_PREFIX}/lib/
COPY --from=talib_builder ${INSTALL_PREFIX}/include/ta-lib ${INSTALL_PREFIX}/include/ta-lib

# Configure linker
RUN ldconfig

# Set environment variables
ENV LD_LIBRARY_PATH=${INSTALL_PREFIX}/lib:${LD_LIBRARY_PATH}
ENV TA_INCLUDE_PATH=${INSTALL_PREFIX}/include
ENV TA_LIBRARY_PATH=${INSTALL_PREFIX}/lib
ENV CFLAGS="-Wno-error=incompatible-pointer-types"

# Install Node.js and Python dependencies
COPY package.json package-lock.json ./
RUN npm install --production

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip wheel setuptools && \
    pip install --no-cache-dir -r requirements.txt --verbose

# Optional: Test TA-Lib
RUN python -c "import numpy; import talib; print('NumPy:', numpy.__version__); print('TA-Lib:', talib.__version__)"

# Copy app code and expose port
COPY . .
EXPOSE 10000
CMD ["node", "server.js"]
