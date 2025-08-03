// src/app/api/download-processed-file/route.js
import { promises as fs } from 'fs';
import path from 'path';
import { processedFilesCache, processingJobs } from '@/lib/fileCache'; // Import the cache and jobs

export const dynamic = 'force-dynamic'; // Ensures the route is not cached
export const runtime = 'nodejs'; // Essential for using Node.js APIs like 'fs'

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

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('id');

  if (!fileId) {
    return new Response(JSON.stringify({ success: false, message: 'File ID is missing.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const fileEntry = processedFilesCache.get(fileId);

  if (!fileEntry) {
    return new Response(JSON.stringify({ success: false, message: 'File not found or has expired.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const fileBuffer = await fs.readFile(fileEntry.filePath);

    // --- START MODIFICATION FOR 3-ACCESS DELETION ---
    // Initialize accessCount if it doesn't exist, otherwise increment it
    fileEntry.accessCount = (fileEntry.accessCount || 0) + 1;
    processedFilesCache.set(fileId, fileEntry); // Update the cache with the new accessCount

    // Check if the file has been accessed 3 or more times
    const ACCESS_THRESHOLD = 3;
    if (fileEntry.accessCount >= ACCESS_THRESHOLD) {
      try {
        await fs.unlink(fileEntry.filePath); // Delete from disk
        processedFilesCache.delete(fileId); // Remove from cache
        
        // Update any jobs that reference this file to indicate it's been automatically cleaned up
        for (const [jobId, job] of processingJobs.entries()) {
          if (job.fileId === fileId) {
            job.fileDeleted = true;
            job.fileDeletedAt = Date.now();
            job.fileDeletedReason = 'auto_cleanup';
            processingJobs.set(jobId, job);
            console.log(`Updated job ${jobId} to indicate automatic file cleanup`);
          }
        }
        
        console.log(`Successfully served and cleaned up file after ${fileEntry.accessCount} accesses: ${fileEntry.filePath}`);
      } catch (cleanupError) {
        console.error(`Error cleaning up file after download ${fileEntry.filePath}:`, cleanupError);
      }
    } else {
      console.log(`File ${fileEntry.filePath} accessed ${fileEntry.accessCount} time(s). Remaining accesses before cleanup: ${ACCESS_THRESHOLD - fileEntry.accessCount}`);
    }
    // --- END MODIFICATION ---

    // Combine standard headers with CORS headers
    const responseHeaders = {
      'Content-Type': fileEntry.mimeType,
      'Content-Disposition': `attachment; filename="${fileEntry.fileName}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate', // Prevent caching
      'Pragma': 'no-cache',
      'Expires': '0',
      ...corsHeaders
    };

    return new Response(fileBuffer, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error(`Error serving file ${fileId}:`, error);
    return new Response(JSON.stringify({ success: false, message: `Server error: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}  