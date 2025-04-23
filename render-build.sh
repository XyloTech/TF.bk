#!/usr/bin/env bash
# exit on error
set -o errexit

echo "--- Installing System Dependencies (TA-Lib) ---"
# Required for TA-Lib compilation
apt-get update && apt-get install -y --no-install-recommends build-essential ta-lib-dev

echo "--- Installing Node.js dependencies ---"
# Consider using --production if you don't need devDependencies on Render
npm install --production

echo "--- Installing Python dependencies ---"
pip install --upgrade pip
pip install -r requirements.txt # Install from your requirements file

# No need to copy strategies or config template here - freqtradeManager handles it

echo "--- Build finished ---"