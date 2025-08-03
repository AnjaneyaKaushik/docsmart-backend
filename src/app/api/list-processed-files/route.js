// src/app/api/list-processed-files/route.js

import { processedFilesCache, processingJobs, getOverallProcessingStatus } from '@/lib/fileCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// --- CORS Headers Definition ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
// --- End CORS Headers Definition ---

// --- OPTIONS handler for preflight requests ---
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function GET() {
  try {
    const filesList = [];
    for (const [id, fileEntry] of processedFilesCache.entries()) {
      filesList.push({
        id: id,
        fileName: fileEntry.fileName,
        mimeType: fileEntry.mimeType,
        timestamp: fileEntry.timestamp,
        accessCount: fileEntry.accessCount || 0,
        toolId: fileEntry.toolId,
        status: 'available'
      });
    }

    // Also include jobs with deleted files that are still within the access period
    for (const [jobId, job] of processingJobs.entries()) {
      if (job.status === 'succeeded' && job.fileDeleted && job.fileId) {
        // Check if this job is still within the access period (10 minutes)
        const now = Date.now();
        const jobAge = now - job.timestamp;
        const accessPeriod = 10 * 60 * 1000; // 10 minutes
        
        if (jobAge <= accessPeriod) {
          filesList.push({
            id: job.fileId,
            fileName: job.outputFileName,
            mimeType: 'application/pdf', // Default for most processed files
            timestamp: job.timestamp,
            accessCount: 0, // File is deleted, so no more accesses
            toolId: job.toolId,
            status: 'deleted',
            deletionReason: job.fileDeletedReason || 'manual'
          });
        }
      }
    }

    const isProcessing = getOverallProcessingStatus(); // Get real-time processing status

    return new Response(JSON.stringify({ 
      success: true, 
      files: filesList,
      isProcessing: isProcessing // Reflects if any job is active
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (error) {
    console.error('Error listing processed files:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      message: `Server error: ${error.message}`,
      isProcessing: getOverallProcessingStatus() // Still reflect current processing status on error
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
