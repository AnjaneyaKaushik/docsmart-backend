// src/app/api/delete-processed-file/route.js

import { promises as fs } from 'fs';
import { processedFilesCache, processingJobs } from '@/lib/fileCache'; // Import the cache and jobs

export const dynamic = 'force-dynamic'; // Ensures the route is not cached
export const runtime = 'nodejs'; // Essential for using Node.js APIs like 'fs'

// --- CORS Headers Definition ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS', // <--- Changed to DELETE
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

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('id');

  if (!fileId) {
    return new Response(JSON.stringify({ success: false, message: 'File ID is missing.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }, // <--- Added CORS headers
    });
  }

  const fileEntry = processedFilesCache.get(fileId);

  if (!fileEntry) {
    return new Response(JSON.stringify({ success: false, message: 'File not found or has already been deleted/expired.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }, // <--- Added CORS headers
    });
  }

  try {
    // Delete the file from the file system
    await fs.unlink(fileEntry.filePath);

    // Remove the file from the cache
    processedFilesCache.delete(fileId);

    // Update any jobs that reference this file to indicate it's been deleted
    for (const [jobId, job] of processingJobs.entries()) {
      if (job.fileId === fileId) {
        job.fileDeleted = true;
        job.fileDeletedAt = Date.now();
        processingJobs.set(jobId, job);
        console.log(`Updated job ${jobId} to indicate file deletion`);
      }
    }

    console.log(`Successfully deleted file from disk and cache: ${fileEntry.filePath}`);

    return new Response(JSON.stringify({ success: true, message: `File '${fileEntry.fileName}' deleted successfully.` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }, // <--- Added CORS headers
    });
  } catch (error) {
    console.error(`Error deleting file ${fileEntry.filePath}:`, error);
    return new Response(JSON.stringify({ success: false, message: `Server error during deletion: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }, // <--- Added CORS headers
    });
  }
}