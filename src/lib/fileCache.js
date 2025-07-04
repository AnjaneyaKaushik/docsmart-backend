// src/lib/fileCache.js
import fs from 'fs/promises';
import path from 'path';

// Define keys for storing caches on globalThis
const PROCESSED_FILES_CACHE_KEY = 'global_processed_files_cache';
const FILE_NAME_TO_ID_MAP_KEY = 'global_file_name_to_id_map';
const CLEANUP_INTERVAL_ID_KEY = 'global_cleanup_interval_id';

// Initialize caches on globalThis to ensure they are singletons across requests
// during development, even with Next.js's module reloading.
if (!globalThis[PROCESSED_FILES_CACHE_KEY]) {
  globalThis[PROCESSED_FILES_CACHE_KEY] = new Map();
}
export const processedFilesCache = globalThis[PROCESSED_FILES_CACHE_KEY];

if (!globalThis[FILE_NAME_TO_ID_MAP_KEY]) {
  globalThis[FILE_NAME_TO_ID_MAP_KEY] = new Map();
}
export const fileNameToIdMap = globalThis[FILE_NAME_TO_ID_MAP_KEY];


// Configuration for cleanup
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Function to clean up expired files from the cache and disk
function cleanupExpiredFiles() {
  const now = Date.now();
  for (const [id, fileData] of processedFilesCache.entries()) {
    if (fileData && fileData.deleteAt && now > fileData.deleteAt) {
      
      fs.unlink(fileData.filePath).catch(err => console.error(`Error deleting expired file ${fileData.filePath}:`, err));
      
      processedFilesCache.delete(id);
      if (fileData.fileName && fileNameToIdMap.get(fileData.fileName) === id) {
        fileNameToIdMap.delete(fileData.fileName);
      }
    }
  }
}

// Start cleanup periodically. Ensure it only runs once globally.
export function startCleanupService() {
  if (!globalThis[CLEANUP_INTERVAL_ID_KEY]) { // Only start if not already running globally
    globalThis[CLEANUP_INTERVAL_ID_KEY] = setInterval(cleanupExpiredFiles, CLEANUP_INTERVAL);
  }
}

// Ensure the cleanup service starts when this module is imported.
startCleanupService();
