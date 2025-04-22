#!/usr/bin/env bash
# exit on error
set -o errexit

echo "--- Installing Node.js dependencies ---"
npm install

echo "--- Installing Python dependencies (Freqtrade) ---"
pip3 install --upgrade pip
pip3 install freqtrade # Use the version/extras you need

# --- Copy strategies from committed repo folder to persistent disk ---
# Render mounts the persistent disk before the build command runs.
# Replace '/data/ft_user_data' with YOUR persistent disk Mount Path.
echo "Copying strategy files from ./user_data/strategies to persistent disk..."
# Ensure the target directory exists on the disk
mkdir -p /data/ft_user_data/strategies
# Copy everything from the committed user_data/strategies folder
cp -r ./user_data/strategies/* /data/ft_user_data/strategies/

echo "--- Build finished ---"