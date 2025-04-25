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

echo "--- Installing System Dependencies (Build Tools & Python 3.10 Pre-reqs) ---"
# NO SUDO for apt-get - assuming it works or Render provides these tools
apt-get update && apt-get install -y --no-install-recommends \
    build-essential wget make software-properties-common \
 && rm -rf /var/lib/apt/lists/*

# Add Deadsnakes PPA for specific Python versions (NO SUDO)
# This might fail if add-apt-repository itself needs root or isn't available
echo "--- Adding Deadsnakes PPA ---"
add-apt-repository -y ppa:deadsnakes/ppa || echo "Warning: add-apt-repository failed, Python 3.10 might not be installable via apt."

# Update package list after adding PPA (NO SUDO)
apt-get update

# Install Python 3.10 runtime, development headers, and venv module (NO SUDO)
echo "--- Installing Python 3.10 ---"
apt-get install -y python3.10 python3.10-dev python3.10-venv \
 && rm -rf /var/lib/apt/lists/* || echo "Warning: Failed to install Python 3.10 via apt-get."


# --- Build and Install TA-Lib C Library ---
echo "--- Downloading and Building TA-Lib C Library (Version ${TA_LIB_VERSION}) ---"
BUILD_DIR=$(mktemp -d) # Create temp dir
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
export CPLUS_INCLUDE_PATH=${INSTALL_PREFIX}/include:${CPLUS_INCLUDE_PATH:-}
export LIBRARY_PATH=${INSTALL_PREFIX}/lib:${LIBRARY_PATH:-}
export LD_LIBRARY_PATH=${INSTALL_PREFIX}/lib:${LD_LIBRARY_PATH:-} # Crucial for runtime linking
export PKG_CONFIG_PATH=${INSTALL_PREFIX}/lib/pkgconfig:${PKG_CONFIG_PATH:-}
echo "C_INCLUDE_PATH=${C_INCLUDE_PATH}"
echo "LIBRARY_PATH=${LIBRARY_PATH}"
echo "LD_LIBRARY_PATH=${LD_LIBRARY_PATH}"

# --- Go back to the project source directory ---
echo "--- Changing directory back to ${PROJECT_SRC_DIR} ---"
cd "${PROJECT_SRC_DIR}"

# --- Create and Activate Python 3.10 Virtual Environment ---
echo "--- Creating Python 3.10 virtual environment (.venv) ---"
# Check if python3.10 command exists before using it
if command -v python3.10 &> /dev/null
then
    python3.10 -m venv .venv
else
    echo "ERROR: python3.10 command not found. Cannot create venv. Check apt-get install step."
    exit 1
fi
echo "--- Activating virtual environment ---"
source .venv/bin/activate # Activate the Python 3.10 environment

# Check Python version inside venv
echo "--- Current Python version ---"
python --version

echo "--- Installing Node.js dependencies ---"
npm install --production

echo "--- Installing Python dependencies (using Python 3.10) ---"
pip install --upgrade pip wheel setuptools

echo "--- Installing NumPy < 1.24 (required by TA-Lib wrapper) ---"
pip install "numpy<1.24" --verbose # Pin numpy version

echo "--- Installing Python requirements (incl. TA-Lib 0.4.24) ---"
# Ensure requirements.txt lists TA-Lib==0.4.24
# Pip will now use the C library installed LOCALLY, older NumPy, AND Python 3.10
pip install -r requirements.txt --verbose

echo "--- Build finished ---"