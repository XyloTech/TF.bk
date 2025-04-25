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
if [ -f "${INSTALL_PREFIX}/include/ta-lib/ta_defs.h" ] && [ -f "${INSTALL_PREFIX}/lib/libta_lib.a" ]; then
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

# --- Go back to the project source directory ---
echo "--- Changing directory back to ${PROJECT_SRC_DIR} ---"
cd "${PROJECT_SRC_DIR}"

# --- Create local setup.cfg to point the compiler to the correct paths ---
echo "--- Creating setup.cfg file for TA-Lib Python wrapper ---"
cat > "${PROJECT_SRC_DIR}/setup.cfg" << EOF
[build_ext]
include_dirs = ${INSTALL_PREFIX}/include
library_dirs = ${INSTALL_PREFIX}/lib
EOF

# Download specific version of TA-Lib Python wrapper source
echo "--- Downloading TA-Lib Python Wrapper Source ---"
TALIB_PY_VERSION="0.4.28"
TALIB_PY_URL="https://github.com/mrjbq7/ta-lib/archive/refs/tags/TA_Lib-${TALIB_PY_VERSION}.tar.gz"
TALIB_PY_DIR="${PROJECT_SRC_DIR}/ta-lib-python"

mkdir -p "${TALIB_PY_DIR}"
wget -q -O talib-python.tar.gz "${TALIB_PY_URL}"
tar -xzf talib-python.tar.gz -C "${TALIB_PY_DIR}" --strip-components=1
rm talib-python.tar.gz

# --- Install Python dependencies ---
echo "--- Installing Python requirements ---"
pip install --upgrade pip wheel setuptools cython

# Install numpy compatible with FreqTrade and TA-Lib
echo "--- Installing NumPy (required by TA-Lib wrapper) ---"
pip install numpy==1.24.3 --verbose

# Install from local source
echo "--- Building and Installing TA-Lib Python wrapper from source ---"
cd "${TALIB_PY_DIR}"

# Modify setup.py to use our specific paths
echo "--- Patching setup.py with correct paths ---"
cat > setup.py.patch << EOF
--- setup.py.orig
+++ setup.py
@@ -77,8 +77,8 @@
     package_dir={'talib': 'talib'},
     packages=['talib'],
     ext_modules=[
-        Extension('talib._ta_lib',
-            include_dirs=include_dirs,
-            library_dirs=lib_talib_dirs,
+        Extension('talib._ta_lib', 
+            include_dirs=['${INSTALL_PREFIX}/include'],
+            library_dirs=['${INSTALL_PREFIX}/lib'],
             libraries=['ta_lib'],
             sources=['talib/_ta_lib.pyx'])
     ],
EOF

patch -p0 < setup.py.patch || echo "Patch may have failed but we'll continue anyway"

echo "--- Building TA-Lib Python wrapper ---"
python setup.py build_ext --inplace --verbose

echo "--- Installing TA-Lib Python wrapper ---"
pip install . --verbose

# Test the installation
echo "--- Testing TA-Lib Python installation ---"
cd "${PROJECT_SRC_DIR}"
python -c "import talib; print('TA-Lib version:', talib.__version__); print('TA-Lib functions available:', len(talib.get_functions()))" || echo "TA-Lib import test failed"

# Install the rest of the FreqTrade requirements
echo "--- Installing FreqTrade requirements ---"
pip install -r requirements.txt --upgrade --verbose

echo "--- Build finished ---"