# Single Stage Dockerfile (Workaround)
FROM python:3.10-slim-bookworm

ARG INSTALL_PREFIX=/usr/local
ARG TA_LIB_VERSION=0.4.0
ARG TA_LIB_URL=http://prdownloads.sourceforge.net/ta-lib/ta-lib-${TA_LIB_VERSION}-src.tar.gz

WORKDIR /opt/render/project/src

# --- Install ALL Build Dependencies (Build Tools, Node.js, Cython, wget) ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg build-essential make cython3 wget \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && NODE_MAJOR=20 \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install nodejs -y --no-install-recommends \
    # Don't remove build-essential, make, wget here yet
    && rm -rf /var/lib/apt/lists/*

# --- Build and Install TA-Lib C Library ---
WORKDIR /tmp # Use /tmp for building TA-Lib C
RUN wget -q -O ta-lib-src.tar.gz ${TA_LIB_URL} && \
    tar -xzf ta-lib-src.tar.gz && \
    cd ta-lib && \
    ./configure --prefix=${INSTALL_PREFIX} && \
    make && \
    make install && \
    cd / && rm -rf /tmp/ta-lib* # Clean up source
RUN ldconfig

# Set environment variables for TA-Lib
ENV LD_LIBRARY_PATH=${INSTALL_PREFIX}/lib:${LD_LIBRARY_PATH}
ENV TA_INCLUDE_PATH=${INSTALL_PREFIX}/include
ENV TA_LIBRARY_PATH=${INSTALL_PREFIX}/lib

# --- Continue in the main project directory ---
WORKDIR /opt/render/project/src

# Copy application dependency files
COPY package.json package-lock.json ./
COPY requirements.txt ./

# Install Node.js dependencies
RUN npm install --production

# --- Install Python Dependencies ---
RUN pip install --no-cache-dir --upgrade pip wheel setuptools
RUN pip install --no-cache-dir "numpy<1.24" --verbose

# --- Build and Install TA-Lib Python wrapper manually ---
ARG TALIB_PY_VERSION=0.4.24
ARG TALIB_PY_URL=https://github.com/mrjbq7/ta-lib/archive/refs/tags/TA_Lib-${TALIB_PY_VERSION}.tar.gz
WORKDIR /tmp/talib-python-build # Use a temporary directory
RUN wget -q -O talib-python.tar.gz ${TALIB_PY_URL} && \
    tar -xzf talib-python.tar.gz --strip-components=1
RUN export CFLAGS="-Wno-error=incompatible-pointer-types" && \
    python setup.py build_ext --verbose && \
    python setup.py install --verbose
RUN python -c "import talib; print('TA-Lib Python Wrapper import successful!')" # Verification
WORKDIR /opt/render/project/src # Go back
RUN rm -rf /tmp/talib-python-build # Clean up source

# Install the rest of the requirements (Ensure TA-Lib REMOVED from requirements.txt)
RUN pip install --no-cache-dir -r requirements.txt --verbose

# Optional: Remove build dependencies now to slightly reduce final image size
# RUN apt-get purge -y --auto-remove build-essential make cython3 wget && rm -rf /var/lib/apt/lists/*

# Copy the rest of your application code
COPY . .
EXPOSE 10000
CMD ["node", "server.js"]