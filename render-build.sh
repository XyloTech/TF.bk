#!/usr/bin/env bash
set -o errexit
set -o pipefail
set -x

# 1. Install TA-Lib C library
echo "--- Installing TA-Lib C Library ---"
TA_LIB_C_VERSION="0.4.0"
INSTALL_PREFIX="/opt/render/project/src/talib_install"

# Create installation directory
mkdir -p ${INSTALL_PREFIX}

# Install build dependencies
apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    make \
    automake \
    autoconf \
    libtool \
 && rm -rf /var/lib/apt/lists/*

# Download and build TA-Lib
BUILD_DIR=$(mktemp -d)
cd "${BUILD_DIR}"
wget -q -O ta-lib-src.tar.gz "https://github.com/TA-Lib/ta-lib/archive/refs/tags/v${TA_LIB_C_VERSION}.tar.gz"
tar -xzf ta-lib-src.tar.gz
cd "ta-lib-${TA_LIB_C_VERSION}"

./configure --prefix=${INSTALL_PREFIX}
make
make install

# 2. Install TA-Lib Python wrapper
echo "--- Installing Python Wrapper ---"
export TA_INCLUDE_PATH="${INSTALL_PREFIX}/include"
export TA_LIBRARY_PATH="${INSTALL_PREFIX}/lib"
export LD_LIBRARY_PATH="${INSTALL_PREFIX}/lib:${LD_LIBRARY_PATH:-}"

# Install specific version compatible with Python 3.10
pip install --upgrade pip
pip install numpy==1.24.3
pip install TA-Lib==0.4.24 --no-binary :all:

# 3. Verify installation
python -c "import talib; print(f'TA-Lib {talib.__version__} installed successfully with {len(talib.get_functions())} functions')"