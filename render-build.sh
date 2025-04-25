#!/usr/bin/env bash
# Exit on error AND print commands executed
set -o errexit
set -x # Print each command before executing it

# --- Project Directory (Ensure this is correct for Render) ---
PROJECT_SRC_DIR="/opt/render/project/src"
# --- Installation Prefix (Local within the project) ---
INSTALL_PREFIX="${PROJECT_SRC_DIR}/talib_install" # Install locally

# Define TA-Lib C library version and download URL
TA_LIB_VERSION="0.4.0"
TA_LIB_URL="http://prdownloads.sourceforge.net/ta-lib/ta-lib-${TA_LIB_VERSION}-src.tar.gz"

echo "--- Installing Build Dependencies (Build tools only) ---"
# Assuming apt-get for build tools works without sudo
apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    make \
 && rm -rf /var/lib/apt/lists/* # Optional: Clean up apt cache

echo "--- Downloading and Building TA-Lib C Library (Version ${TA_LIB_VERSION}) ---"
BUILD_DIR=$(mktemp -d)
cd "${BUILD_DIR}"
wget -q -O ta-lib-src.tar.gz ${TA_LIB_URL}
tar -xzf ta-lib-src.tar.gz
cd ta-lib/
./configure --prefix=${INSTALL_PREFIX} || { echo './configure failed'; exit 1; }
make || { echo 'make failed'; exit 1; }
make install || { echo 'make install failed'; exit 1; } # Local install, NO SUDO
# Verify installation
if [ ! -f "${INSTALL_PREFIX}/include/ta-lib/ta_defs.h" ]; then
    echo "ERROR: Did NOT find ${INSTALL_PREFIX}/include/ta-lib/ta_defs.h after local make install!"
    ls -l "${INSTALL_PREFIX}/include/" || true
    ls -l "${INSTALL_PREFIX}/lib/" || true
    exit 1
fi
echo "SUCCESS: Found ${INSTALL_PREFIX}/include/ta-lib/ta_defs.h"
cd /
rm -rf "${BUILD_DIR}"

# --- Set Environment Variables (Pointing to LOCAL install location) ---
echo "--- Setting Environment Variables for TA-Lib ---"
export C_INCLUDE_PATH=${INSTALL_PREFIX}/include:${C_INCLUDE_PATH:-}
export LIBRARY_PATH=${INSTALL_PREFIX}/lib:${LIBRARY_PATH:-}
export LD_LIBRARY_PATH=${INSTALL_PREFIX}/lib:${LD_LIBRARY_PATH:-} # Crucial for runtime linking
echo "C_INCLUDE_PATH=${C_INCLUDE_PATH}"
echo "LIBRARY_PATH=${LIBRARY_PATH}"
echo "LD_LIBRARY_PATH=${LD_LIBRARY_PATH}"

# --- Go back to the project source directory ---
echo "--- Changing directory back to ${PROJECT_SRC_DIR} ---"
cd "${PROJECT_SRC_DIR}"

echo "--- Installing Node.js dependencies ---"
npm install --production

echo "--- Installing Python dependencies ---"
pip install --upgrade pip wheel setuptools

# --- Install specific dependency versions BEFORE requirements.txt ---
echo "--- Installing Pinned Python Dependencies ---"
# Pin NumPy to a version known to work with older TA-Lib wrappers
pip install "numpy<1.24" --verbose
# Pin TA-Lib Python wrapper to a version known to be more stable/less strict
pip install TA-Lib==0.4.24 --verbose

echo "--- Installing Remaining Python requirements ---"
# IMPORTANT: Ensure TA-Lib and numpy lines are commented out or removed from requirements.txt
echo "Installing packages from requirements.txt (excluding numpy and TA-Lib)..."
pip install -r requirements.txt --verbose

echo "--- Build finished ---"