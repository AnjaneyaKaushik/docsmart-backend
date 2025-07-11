// src/app/api/list-processed-files/route.js

import { processedFilesCache } from '@/lib/fileCache';

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
        accessCount: fileEntry.accessCount || 0
      });
    }

    return new Response(JSON.stringify({ success: true, files: filesList }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }, // <--- Added CORS headers
    });

  } catch (error) {
    console.error('Error listing processed files:', error);
    return new Response(JSON.stringify({ success: false, message: `Server error: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }, // <--- Added CORS headers
    });
  }
}