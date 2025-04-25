#!/usr/bin/env bash
# exit on error
set -o errexit

echo "--- Installing System Dependencies (TA-Lib) ---"
# Required for TA-Lib compilation
# Use sudo to run apt-get commands
sudo apt-get update && sudo apt-get install -y --no-install-recommends \
    build-essential \
    ta-lib-dev \
 && sudo rm -rf /var/lib/apt/lists/* # Also need sudo for cleanup if you use it

# --- DIAGNOSTIC COMMANDS (Keep for now) ---
echo "--- Checking TA-Lib header installation ---"
find /usr -name ta_defs.h || echo "ta_defs.h not found"
find /usr -name libta_lib.a || echo "libta_lib.a not found"
find /usr -name libta_lib.so || echo "libta_lib.so not found"
echo "--- Listing /usr/include/ta-lib (if exists) ---"
ls -l /usr/include/ta-lib/ || echo "/usr/include/ta-lib not found"
echo "--- Listing /usr/local/include/ta-lib (if exists) ---"
ls -l /usr/local/include/ta-lib/ || echo "/usr/local/include/ta-lib not found"
echo "--- End TA-Lib checks ---"

# --- Set Explicit Compiler Flags --- ADDED THIS BLOCK ---
# Assuming headers are installed in /usr/include/ta-lib and libs in /usr/lib/...
# Adjust paths if diagnostic commands show otherwise (e.g., /usr/local/include)
echo "--- Setting CFLAGS and LDFLAGS for TA-Lib ---"
export C_INCLUDE_PATH=/usr/include/ta-lib:$C_INCLUDE_PATH
export CPLUS_INCLUDE_PATH=/usr/include/ta-lib:$CPLUS_INCLUDE_PATH
# Often library path setting isn't strictly needed if headers are found, but doesn't hurt
export LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:$LIBRARY_PATH # Common location for libs on Debian/Ubuntu
export LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
# --- END ADDED BLOCK ---

echo "--- Installing Node.js dependencies ---"
# Consider using --production if you don't need devDependencies on Render
npm install --production

echo "--- Installing Python dependencies ---"
pip install --upgrade pip
pip install -r requirements.txt # Install from your requirements file

# No need to copy strategies or config template here - freqtradeManager handles it

echo "--- Build finished ---"