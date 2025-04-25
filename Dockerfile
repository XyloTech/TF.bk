# Stage 1: Build TA-Lib C Library using a base image with build tools
FROM python:3.10-slim-bookworm as talib_builder

ARG TA_LIB_VERSION=0.4.0
ARG TA_LIB_URL=http://prdownloads.sourceforge.net/ta-lib/ta-lib-${TA_LIB_VERSION}-src.tar.gz
ARG INSTALL_PREFIX=/usr/local

# Install build dependencies for TA-Lib C library
# Running as root inside Docker build context
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    make \
    && rm -rf /var/lib/apt/lists/*

# Download, build, and install TA-Lib C library system-wide in this stage
WORKDIR /tmp
RUN wget -q -O ta-lib-src.tar.gz ${TA_LIB_URL} && \
    tar -xzf ta-lib-src.tar.gz && \
    cd ta-lib && \
    ./configure --prefix=${INSTALL_PREFIX} && \
    make && \
    make install

# --- End of TA-Lib builder stage ---

# Stage 2: Build the final application image
FROM python:3.10-slim-bookworm

ARG INSTALL_PREFIX=/usr/local
WORKDIR /opt/render/project/src

# Install Node.js AND Build Tools needed for pip install in the final stage
# Running as root inside Docker build context
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    build-essential \
    make \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && NODE_MAJOR=20 \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install nodejs -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy TA-Lib library/headers from the builder stage to the standard location
COPY --from=talib_builder ${INSTALL_PREFIX}/lib/libta* ${INSTALL_PREFIX}/lib/
COPY --from=talib_builder ${INSTALL_PREFIX}/include/ta-lib ${INSTALL_PREFIX}/include/ta-lib

# Update linker cache after copying libraries
RUN ldconfig

# Set environment variables for TA-Lib (needed for pip install AND runtime)
# Point to the standard location where we copied the files
ENV C_INCLUDE_PATH=${INSTALL_PREFIX}/include:${C_INCLUDE_PATH}
ENV LIBRARY_PATH=${INSTALL_PREFIX}/lib:${LIBRARY_PATH}
ENV LD_LIBRARY_PATH=${INSTALL_PREFIX}/lib:${LD_LIBRARY_PATH}

# Copy application dependency files
COPY package.json package-lock.json ./
COPY requirements.txt ./

# Install Node.js dependencies
RUN npm install --production

# Install Python dependencies
# Ensure NumPy < 1.24 and TA-Lib == 0.4.24 are in requirements.txt
RUN pip install --no-cache-dir --upgrade pip wheel setuptools && \
    # Explicitly set CFLAGS here to ignore the specific warning causing the error
    export CFLAGS="-Wno-error=incompatible-pointer-types" && \
    pip install --no-cache-dir -r requirements.txt --verbose

# Copy the rest of your application code
COPY . .

# Expose port (e.g., 10000 for Render)
EXPOSE 10000

# Define the command to run your application
CMD ["node", "server.js"]