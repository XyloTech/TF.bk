#!/usr/bin/env bash
# exit on error
set -o errexit


# Define TA-Lib C library version and download URL
TA_LIB_VERSION="0.4.0" # Common version, check if you need a specific one
TA_LIB_URL="http://prdownloads.sourceforge.net/ta-lib/ta-lib-${TA_LIB_VERSION}-src.tar.gz"
INSTALL_PREFIX="/usr/local" # Standard installation location

echo "--- Installing Build Dependencies ---"
# Need tools to download and compile C code
# Using sudo for system-wide package installation
sudo apt-get update && sudo apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    make \
 && sudo rm -rf /var/lib/apt/lists/* # Optional: Clean up apt cache

echo "--- Downloading and Building TA-Lib C Library (Version ${TA_LIB_VERSION}) ---"
# Create a temporary directory for building
BUILD_DIR=$(mktemp -d)
cd "${BUILD_DIR}"

# Download the source code
echo "Downloading from ${TA_LIB_URL}..."
wget -q -O ta-lib-src.tar.gz ${TA_LIB_URL}
tar -xzf ta-lib-src.tar.gz
cd ta-lib/ # Navigate into the extracted source directory

echo "--- Configuring TA-Lib (installing to ${INSTALL_PREFIX}) ---"
# Configure the build, specifying the installation prefix
# This generates the Makefile based on the system environment
./configure --prefix=${INSTALL_PREFIX}

echo "--- Compiling TA-Lib ---"
# Compile the C code using the generated Makefile
make

echo "--- Installing TA-Lib C library (requires sudo) ---"
# Install the compiled library and headers to the prefix location
# Needs sudo because /usr/local is a system directory
sudo make install

echo "--- Cleaning up TA-Lib source ---"
# Go back up and remove the temporary build directory
cd / # Go to root or another safe directory before removing BUILD_DIR
rm -rf "${BUILD_DIR}"

# --- Set Environment Variables (Explicitly point to the install location) ---
# This helps pip's build process find the manually installed library/headers
echo "--- Setting Environment Variables for TA-Lib ---"
export C_INCLUDE_PATH=${INSTALL_PREFIX}/include:$C_INCLUDE_PATH
export CPLUS_INCLUDE_PATH=${INSTALL_PREFIX}/include:$CPLUS_INCLUDE_PATH
export LIBRARY_PATH=${INSTALL_PREFIX}/lib:$LIBRARY_PATH
export LD_LIBRARY_PATH=${INSTALL_PREFIX}/lib:$LD_LIBRARY_PATH
# Tell pkg-config where to find the .pc file if TA-Lib installs one
export PKG_CONFIG_PATH=${INSTALL_PREFIX}/lib/pkgconfig:$PKG_CONFIG_PATH

# --- DIAGNOSTIC COMMANDS (After Manual Install) ---
# Verify that the files were installed where expected
echo "--- Checking TA-Lib installation in ${INSTALL_PREFIX} ---"
find ${INSTALL_PREFIX} -name ta_defs.h || echo "${INSTALL_PREFIX}: ta_defs.h not found"
find ${INSTALL_PREFIX} -name libta_lib.a || echo "${INSTALL_PREFIX}: libta_lib.a not found"
find ${INSTALL_PREFIX} -name libta_lib.so || echo "${INSTALL_PREFIX}: libta_lib.so not found"
ls -l ${INSTALL_PREFIX}/include/ta-lib/ || echo "${INSTALL_PREFIX}/include/ta-lib not found"
ls -l ${INSTALL_PREFIX}/lib/ || echo "${INSTALL_PREFIX}/lib not found"
echo "--- End TA-Lib checks ---"

# --- Go back to the original project source directory ---
# IMPORTANT: Ensure this path is correct for Render's build environment
# Render typically clones into /opt/render/project/src
PROJECT_SRC_DIR="/opt/render/project/src"
echo "--- Changing directory to ${PROJECT_SRC_DIR} ---"
cd "${PROJECT_SRC_DIR}"
echo "--- Installing Node.js dependencies ---"
# Consider using --production if you don't need devDependencies on Render
npm install --production

echo "--- Installing Python dependencies ---"
pip install --upgrade pip
pip install -r requirements.txt # Install from your requirements file

# No need to copy strategies or config template here - freqtradeManager handles it

echo "--- Build finished ---"