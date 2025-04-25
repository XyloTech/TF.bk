# Stage 1: Build TA-Lib C Library (Keep as is)
FROM python:3.10-slim-bookworm as talib_builder
ARG TA_LIB_VERSION=0.4.0
ARG TA_LIB_URL=http://prdownloads.sourceforge.net/ta-lib/ta-lib-${TA_LIB_VERSION}-src.tar.gz
ARG INSTALL_PREFIX=/usr/local
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential wget make && rm -rf /var/lib/apt/lists/*
WORKDIR /tmp
RUN wget -q -O ta-lib-src.tar.gz ${TA_LIB_URL} && \
    tar -xzf ta-lib-src.tar.gz && \
    cd ta-lib && \
    ./configure --prefix=${INSTALL_PREFIX} && \
    make && \
    make install

# Stage 2: Final application image
FROM python:3.10-slim-bookworm
ARG INSTALL_PREFIX=/usr/local
WORKDIR /opt/render/project/src

# Install Node.js and Build Tools (incl. Cython)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg build-essential make cython3 \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && NODE_MAJOR=20 \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install nodejs -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy TA-Lib artifacts
COPY --from=talib_builder ${INSTALL_PREFIX}/lib/libta* ${INSTALL_PREFIX}/lib/
COPY --from=talib_builder ${INSTALL_PREFIX}/include/ta-lib ${INSTALL_PREFIX}/include/ta-lib
RUN ldconfig

# Set ENV vars for TA-Lib (Runtime linking)
ENV LD_LIBRARY_PATH=${INSTALL_PREFIX}/lib:${LD_LIBRARY_PATH}
# Set ENV vars for TA-Lib (Build time - CFLAGS handled directly below)
ENV TA_INCLUDE_PATH=${INSTALL_PREFIX}/include
ENV TA_LIBRARY_PATH=${INSTALL_PREFIX}/lib

# Copy application dependency files
COPY package.json package-lock.json ./
COPY requirements.txt ./

# Install Node.js dependencies
RUN npm install --production

# Install Python build essentials and NumPy first
RUN pip install --no-cache-dir --upgrade pip wheel setuptools
RUN pip install --no-cache-dir "numpy<1.24" --verbose

# --- Download, Build, and Install TA-Lib Python Wrapper Manually --- START
# Download specific TA-Lib Python wrapper source
ARG TALIB_PY_VERSION=0.4.24 # Use the pinned version
ARG TALIB_PY_URL=https://github.com/mrjbq7/ta-lib/archive/refs/tags/TA_Lib-${TALIB_PY_VERSION}.tar.gz
WORKDIR /tmp/talib-python-build # Use a temporary directory
RUN wget -q -O talib-python.tar.gz ${TALIB_PY_URL} && \
    tar -xzf talib-python.tar.gz --strip-components=1

# Build the extension directly, passing CFLAGS to ignore the error
# Use python3.10 explicitly if needed, though it should be default in this image
RUN CFLAGS="-Wno-error=incompatible-pointer-types" python setup.py build_ext --verbose && \
    python setup.py install --verbose # Use setup.py install

# Verify installation by trying to import
# Run this check immediately after manual install
RUN python -c "import talib; print('TA-Lib Python Wrapper import successful!')"

WORKDIR /opt/render/project/src # Go back to the main work directory
RUN rm -rf /tmp/talib-python-build # Clean up source
# --- END ---

# Install the rest of the requirements
# IMPORTANT: Ensure TA-Lib is REMOVED from requirements.txt
RUN pip install --no-cache-dir -r requirements.txt --verbose

# Copy the rest of your application code
COPY . .
EXPOSE 10000
CMD ["node", "server.js"]