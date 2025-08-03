// src/lib/fileCache.js
import fs from 'fs/promises';
import path from 'path';

// Define keys for storing caches on globalThis
const PROCESSED_FILES_CACHE_KEY = 'global_processed_files_cache';
const FILE_NAME_TO_ID_MAP_KEY = 'global_file_name_to_id_map';
const CLEANUP_INTERVAL_ID_KEY = 'global_cleanup_interval_id';
// New key for storing real-time processing jobs
const PROCESSING_JOBS_KEY = 'global_processing_jobs';

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

// Initialize processingJobs Map
if (!globalThis[PROCESSING_JOBS_KEY]) {
  globalThis[PROCESSING_JOBS_KEY] = new Map(); // Map<jobId, {status: 'active' | 'completed' | 'failed', toolId: string, fileNames: string[], progress: number}>
}
export const processingJobs = globalThis[PROCESSING_JOBS_KEY];


// Configuration for cleanup
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes
const JOB_ACCESS_PERIOD = 10 * 60 * 1000; // 10 minutes - how long completed jobs stay available

// Function to clean up expired files from the cache and disk
function cleanupExpiredFiles() {
  const now = Date.now();
  for (const [id, fileData] of processedFilesCache.entries()) {
    // Check if deleteAt exists and if the file has expired
    // Also, ensure that if a file is still linked to an active processing job, it's not deleted prematurely.
    // However, for simplicity here, we assume cleanup happens after job completion/failure.
    if (fileData && fileData.deleteAt && now > fileData.deleteAt) {
      fs.unlink(fileData.filePath).catch(err => console.error(`Error deleting expired file ${fileData.filePath}:`, err));
      
      processedFilesCache.delete(id);
      if (fileData.fileName && fileNameToIdMap.get(fileData.fileName) === id) {
        fileNameToIdMap.delete(fileData.fileName);
      }
    }
  }

  // Additionally, clean up old entries in processingJobs if they are completed/failed
  for (const [jobId, jobData] of processingJobs.entries()) {
    // Remove jobs that are completed or failed after the access period (10 minutes)
    // This prevents the map from growing indefinitely and gives clients time to check status and download.
    if (jobData.status !== 'active' && (now - jobData.timestamp) > JOB_ACCESS_PERIOD) {
      processingJobs.delete(jobId);
      console.log(`Cleaned up old processing job: ${jobId} (status: ${jobData.status}) after ${JOB_ACCESS_PERIOD / 1000 / 60} minutes`);
    }
  }
}

// Helper functions for managing processing jobs
export function addProcessingJob(jobId, toolId, fileNames) {
  processingJobs.set(jobId, {
    status: 'active',
    toolId,
    fileNames,
    progress: 0,
    timestamp: Date.now(), // Timestamp for cleanup
  });
  console.log(`Added processing job: ${jobId}, Tool: ${toolId}, Files: ${fileNames.join(', ')}`);
}

export function updateProcessingJobStatus(jobId, status, progress = null, outputFileName = null, fileId = null) {
  const job = processingJobs.get(jobId);
  if (job) {
    job.status = status;
    if (progress !== null) {
      job.progress = progress;
    }
    if (outputFileName !== null) {
      job.outputFileName = outputFileName;
    }
    if (fileId !== null) {
      job.fileId = fileId;
    }
    job.timestamp = Date.now(); // Update timestamp on status change
    processingJobs.set(jobId, job);
    console.log(`Updated processing job: ${jobId}, Status: ${status}, Progress: ${progress !== null ? progress : job.progress}, Output: ${outputFileName || 'none'}, FileId: ${fileId || 'none'}`);
  }
}

export function removeProcessingJob(jobId) {
  processingJobs.delete(jobId);
  console.log(`Removed processing job: ${jobId}`);
}

export function getOverallProcessingStatus() {
  // Check if any job in the map is currently 'active'
  for (const jobData of processingJobs.values()) {
    if (jobData.status === 'active') {
      return true;
    }
  }
  return false;
}

// Start cleanup periodically. Ensure it only runs once globally.
export function startCleanupService() {
  if (!globalThis[CLEANUP_INTERVAL_ID_KEY]) { 
    const intervalId = setInterval(cleanupExpiredFiles, CLEANUP_INTERVAL);
    globalThis[CLEANUP_INTERVAL_ID_KEY] = intervalId;
    // Also run immediately on start for any files that might have expired
    cleanupExpiredFiles(); 
    console.log('File cleanup service started with 10-minute interval.');
  }
}
