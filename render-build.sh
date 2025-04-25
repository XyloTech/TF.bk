#!/usr/bin/env bash
# Exit on error AND print commands executed
set -o errexit
set -o pipefail
set -x # Print each command before executing it

# --- Project Directory (Ensure this is correct for Render) ---
PROJECT_SRC_DIR="/opt/render/project/src"
# --- Installation Prefix (Local within the project) ---
INSTALL_PREFIX="${PROJECT_SRC_DIR}/talib_install" # Install locally

# Define TA-Lib C library version and download URL
TA_LIB_VERSION="0.4.0"
TA_LIB_URL="http://prdownloads.sourceforge.net/ta-lib/ta-lib-${TA_LIB_VERSION}-src.tar.gz"

echo "--- Installing Build Dependencies ---"
apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    make \
    gcc \
    g++ \
    pkg-config \
 && rm -rf /var/lib/apt/lists/*

echo "--- Downloading and Building TA-Lib C Library (Version ${TA_LIB_VERSION}) ---"
BUILD_DIR=$(mktemp -d)
cd "${BUILD_DIR}"

echo "Downloading from ${TA_LIB_URL}..."
wget -q -O ta-lib-src.tar.gz ${TA_LIB_URL}
tar -xzf ta-lib-src.tar.gz
cd ta-lib/

echo "--- Configuring TA-Lib (installing LOCALLY to ${INSTALL_PREFIX}) ---"
# Configure the build, specifying the LOCAL installation prefix
./configure --prefix=${INSTALL_PREFIX} || { echo './configure failed'; exit 1; }

echo "--- Compiling TA-Lib C library ---"
make -j$(nproc) || { echo 'make failed'; exit 1; }

echo "--- Installing TA-Lib C library to ${INSTALL_PREFIX} ---"
make install || { echo 'make install failed'; exit 1; }

echo "--- Verifying LOCAL C Library Installation ---"
if [ -f "${INSTALL_PREFIX}/include/ta-lib/ta_defs.h" ] && [ -f "${INSTALL_PREFIX}/lib/libta_lib.a" ] && [ -f "${INSTALL_PREFIX}/lib/libta_lib.la" ]; then
    echo "SUCCESS: TA-Lib C library files found in expected locations"
    # List the installed files for verification
    find ${INSTALL_PREFIX} -type f | grep -E 'lib/libta|include/ta-lib' | sort
else
    echo "ERROR: TA-Lib C library files not found after installation"
    find ${INSTALL_PREFIX} -type f || echo "No files found in ${INSTALL_PREFIX}"
    exit 1
fi

# --- Set Environment Variables (Pointing to LOCAL install location) ---
echo "--- Setting Environment Variables for TA-Lib ---"
export TA_INCLUDE_PATH="${INSTALL_PREFIX}/include/ta-lib"
export TA_LIBRARY_PATH="${INSTALL_PREFIX}/lib"
export C_INCLUDE_PATH="${INSTALL_PREFIX}/include:${C_INCLUDE_PATH:-}"
export CPLUS_INCLUDE_PATH="${INSTALL_PREFIX}/include:${CPLUS_INCLUDE_PATH:-}"
export LIBRARY_PATH="${INSTALL_PREFIX}/lib:${LIBRARY_PATH:-}"
export LD_LIBRARY_PATH="${INSTALL_PREFIX}/lib:${LD_LIBRARY_PATH:-}"
export PKG_CONFIG_PATH="${INSTALL_PREFIX}/lib/pkgconfig:${PKG_CONFIG_PATH:-}"

# Create symlinks for the library so the linker can find it more easily
mkdir -p /usr/local/lib
ln -sf ${INSTALL_PREFIX}/lib/libta_lib.a /usr/local/lib/
ln -sf ${INSTALL_PREFIX}/lib/libta_lib.la /usr/local/lib/
if [ -f "${INSTALL_PREFIX}/lib/libta_lib.so" ]; then
    ln -sf ${INSTALL_PREFIX}/lib/libta_lib.so /usr/local/lib/
fi

# --- Go back to the project source directory ---
echo "--- Changing directory back to ${PROJECT_SRC_DIR} ---"
cd "${PROJECT_SRC_DIR}"

# --- Install Python dependencies ---
echo "--- Installing Python requirements ---"
pip install --upgrade pip wheel setuptools cython

# Install numpy first before TA-Lib
echo "--- Installing NumPy (required by TA-Lib wrapper) ---"
pip install numpy==1.24.3 --verbose

# Create the TA_LIBRARY_PATH environment variable file for setup.py
echo "--- Creating setup.cfg for TA-Lib Python wrapper ---"
cat > setup.cfg << EOF
[build_ext]
include_dirs = ${INSTALL_PREFIX}/include
library_dirs = ${INSTALL_PREFIX}/lib:/usr/local/lib:/usr/lib
EOF

# Install TA-Lib Python wrapper directly from source
echo "--- Installing TA-Lib Python wrapper from source ---"
pip install --no-cache-dir --verbose git+https://github.com/mrjbq7/ta-lib.git@master

# Verify TA-Lib installation
echo "--- Verifying TA-Lib Python Installation ---"
python -c "import talib; print('TA-Lib Python wrapper installed successfully!')" || echo "TA-Lib Python wrapper installation failed!"

# Install the rest of the requirements for FreqTrade
echo "--- Installing FreqTrade requirements ---"
pip install -r requirements.txt --upgrade --verbose

echo "--- Build finished ---"