// /services/freqtrade/fileUtils.js
const fs = require("fs").promises;
const path = require("path");

async function ensureDirExists(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return true;
  } catch (err) {
    throw new Error(`Failed to create directory: ${dirPath}. ${err.message}`);
  }
}

async function copyFileSafe(sourcePath, destPath) {
  try {
    await fs.access(sourcePath);
    await fs.copyFile(sourcePath, destPath);
  } catch (err) {
    throw new Error(
      `Unable to copy strategy from ${sourcePath} to ${destPath}: ${err.message}`
    );
  }
}

module.exports = {
  ensureDirExists,
  copyFileSafe,
};
