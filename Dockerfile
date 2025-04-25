# syntax=docker/dockerfile:1.4

# Stage 1: Core system dependencies
FROM python:3.10-slim-bookworm as system-base

# Install essential build tools and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    curl \
    ca-certificates \
    gnupg \
    automake \
    autoconf \
    libtool \
    git \
    && rm -rf /var/lib/apt/lists/*

# Stage 2: TA-Lib builder
FROM system-base as talib-builder

# Compile TA-Lib with sequential build to avoid race conditions
WORKDIR /tmp
RUN wget -q http://prdownloads.sourceforge.net/ta-lib/ta-lib-0.4.0-src.tar.gz \
    && tar -xzf ta-lib-0.4.0-src.tar.gz \
    && cd ta-lib/ \
    && sed -i.bak 's/-O3/-O2/g' configure.in configure \
    && ./configure --prefix=/usr/local \
    && make -j1 CFLAGS="-Wno-error=incompatible-pointer-types -DTA_=TA_" \
    && make install \
    && rm -rf /tmp/ta-lib*

# Stage 3: Node.js builder
FROM system-base as node-builder

# Install Node.js 20.x (Debian package locations)
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Stage 4: Python environment builder
FROM system-base as python-builder

# Copy compiled TA-Lib
COPY --from=talib-builder /usr/local/lib/libta* /usr/local/lib/
COPY --from=talib-builder /usr/local/include/ta-lib /usr/local/include/ta-lib
RUN ldconfig

# Create and activate virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies with pinned versions
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip wheel setuptools \
    && CFLAGS="-Wno-error=incompatible-pointer-types" \
    pip install --no-cache-dir -r requirements.txt

# Stage 5: Final production image
FROM python:3.10-slim-bookworm

WORKDIR /opt/render/project/src

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy TA-Lib
COPY --from=talib-builder /usr/local/lib/libta* /usr/local/lib/
COPY --from=talib-builder /usr/local/include/ta-lib /usr/local/include/ta-lib
RUN ldconfig

# Copy Python environment
COPY --from=python-builder /opt/venv /opt/venv

# Copy Node.js from builder (Debian package locations)
COPY --from=node-builder /usr/bin/node /usr/local/bin/node
COPY --from=node-builder /usr/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm

# Environment variables
ENV PATH="/opt/venv/bin:/usr/local/bin:$PATH"
ENV LD_LIBRARY_PATH="/usr/local/lib"
ENV TA_INCLUDE_PATH="/usr/local/include"
ENV TA_LIBRARY_PATH="/usr/local/lib"
ENV CFLAGS="-Wno-error=incompatible-pointer-types"

# Install Node.js dependencies
COPY package.json package-lock.json ./
RUN npm install --production

# Copy application code
COPY . .

# Verify installations
RUN python -c "import talib; print(f'TA-Lib {talib.__version__} OK')" \
    && python -c "import freqtrade; print(f'Freqtrade {freqtrade.__version__} OK')" \
    && python -c "import numpy; print(f'NumPy {numpy.__version__} OK')" \
    && node --version \
    && npm --version

EXPOSE 10000
CMD ["node", "server.js"]