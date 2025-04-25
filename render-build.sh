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

echo "--- Installing Build Dependencies (NO SUDO NEEDED for these tools) ---"
# Install essential tools using apt-get (assuming this works without sudo for basic package install)
apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    make \
 && rm -rf /var/lib/apt/lists/* # Clean up apt cache

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

echo "--- Compiling TA-Lib ---"
# Compile the C code using the generated Makefile
make || { echo 'make failed'; exit 1; }

echo "--- Installing TA-Lib C library (LOCALLY, NO SUDO) ---"
# Install the compiled library and headers to the LOCAL prefix location
make install || { echo 'make install failed'; exit 1; }

echo "--- Verifying LOCAL C Library Installation ---"
# Check right after installation if the header file exists where expected
if [ -f "${INSTALL_PREFIX}/include/ta-lib/ta_defs.h" ]; then
    echo "SUCCESS: Found ${INSTALL_PREFIX}/include/ta-lib/ta_defs.h"
else
    echo "ERROR: Did NOT find ${INSTALL_PREFIX}/include/ta-lib/ta_defs.h after local make install!"
    # List the contents of the target directories for clues
    echo "Listing ${INSTALL_PREFIX}/include/ ..."
    ls -l "${INSTALL_PREFIX}/include/" || true
    echo "Listing ${INSTALL_PREFIX}/lib/ ..."
    ls -l "${INSTALL_PREFIX}/lib/" || true
    exit 1
fi

echo "--- Cleaning up TA-Lib source ---"
# Go back up and remove the temporary build directory
cd /
rm -rf "${BUILD_DIR}"

# --- Set Environment Variables (Pointing to LOCAL install location) ---
echo "--- Setting Environment Variables for TA-Lib ---"
export C_INCLUDE_PATH=${INSTALL_PREFIX}/include:${C_INCLUDE_PATH:-}
export CPLUS_INCLUDE_PATH=${INSTALL_PREFIX}/include:${CPLUS_INCLUDE_PATH:-}
export LIBRARY_PATH=${INSTALL_PREFIX}/lib:${LIBRARY_PATH:-}
export LD_LIBRARY_PATH=${INSTALL_PREFIX}/lib:${LD_LIBRARY_PATH:-}
export PKG_CONFIG_PATH=${INSTALL_PREFIX}/lib/pkgconfig:${PKG_CONFIG_PATH:-}
# Verify the variables are set
echo "C_INCLUDE_PATH=${C_INCLUDE_PATH}"
echo "LIBRARY_PATH=${LIBRARY_PATH}"
echo "LD_LIBRARY_PATH=${LD_LIBRARY_PATH}"

# --- Go back to the project source directory ---
echo "--- Changing directory back to ${PROJECT_SRC_DIR} ---"
cd "${PROJECT_SRC_DIR}"

echo "--- Installing Node.js dependencies ---"
# Make sure package.json is in PROJECT_SRC_DIR
npm install --production

echo "--- Installing Python dependencies ---"
# Make sure requirements.txt is in PROJECT_SRC_DIR
pip install --upgrade pip wheel setuptools

echo "--- Installing compatible NumPy version ---"
# Install a SPECIFIC version of numpy that's compatible with TA-Lib
pip install numpy==1.23.5 --verbose

# Create a temporary file with requirements excluding TA-Lib
echo "--- Preparing requirements without TA-Lib ---"
grep -v "TA-Lib" requirements.txt > requirements_no_talib.txt || true

echo "--- Installing Python requirements (excluding TA-Lib) ---"
pip install -r requirements_no_talib.txt --verbose

echo "--- Installing TA-Lib Python wrapper from source ---"
# Install a SPECIFIC version of TA-Lib that works with the numpy version
pip install ta-lib==0.4.24 --verbose

echo "--- Build finished ---"