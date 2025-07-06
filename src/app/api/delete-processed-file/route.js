// src/app/api/delete-processed-file/route.js

import { promises as fs } from 'fs';
import { processedFilesCache } from '@/lib/fileCache'; // Import the cache

export const dynamic = 'force-dynamic'; // Ensures the route is not cached
export const runtime = 'nodejs'; // Essential for using Node.js APIs like 'fs'

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('id');

  if (!fileId) {
    return new Response(JSON.stringify({ success: false, message: 'File ID is missing.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const fileEntry = processedFilesCache.get(fileId);

  if (!fileEntry) {
    return new Response(JSON.stringify({ success: false, message: 'File not found or has already been deleted/expired.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Delete the file from the file system
    await fs.unlink(fileEntry.filePath);

    // Remove the file from the cache
    processedFilesCache.delete(fileId);

    console.log(`Successfully deleted file from disk and cache: ${fileEntry.filePath}`);

    return new Response(JSON.stringify({ success: true, message: `File '${fileEntry.fileName}' deleted successfully.` }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(`Error deleting file ${fileEntry.filePath}:`, error);
    return new Response(JSON.stringify({ success: false, message: `Server error during deletion: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}