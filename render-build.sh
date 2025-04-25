#!/usr/bin/env bash
# exit on error
set -o errexit

echo "--- Installing System Dependencies (TA-Lib) ---"
# Required for TA-Lib compilation
apt-get update && apt-get install -y --no-install-recommends build-essential ta-lib-dev

echo "--- Checking TA-Lib header installation ---"
find /usr -name ta_defs.h # Search for the header file
find /usr -name libta_lib.a # Search for the static library
find /usr -name libta_lib.so # Search for the shared library
echo "--- Listing /usr/include ---"
ls -l /usr/include/ # See if ta-lib dir exists
echo "--- Listing /usr/include/ta-lib (if exists) ---"
ls -l /usr/include/ta-lib/ || echo "/usr/include/ta-lib not found"
echo "--- Listing /usr/local/include ---"
ls -l /usr/local/include/
echo "--- Listing /usr/local/include/ta-lib (if exists) ---"
ls -l /usr/local/include/ta-lib/ || echo "/usr/local/include/ta-lib not found"
echo "--- End TA-Lib checks ---"


echo "--- Installing Node.js dependencies ---"
# Consider using --production if you don't need devDependencies on Render
npm install --production

echo "--- Installing Python dependencies ---"
pip install --upgrade pip
pip install -r requirements.txt # Install from your requirements file

# No need to copy strategies or config template here - freqtradeManager handles it

echo "--- Build finished ---"