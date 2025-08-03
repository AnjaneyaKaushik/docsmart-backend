// src/app/api/file-size/route.js
import fs from 'fs/promises';
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

export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('id');

  if (!fileId) {
    return new Response(JSON.stringify({ success: false, message: 'File ID is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const cacheEntry = processedFilesCache.get(fileId);

  if (!cacheEntry) {
    return new Response(JSON.stringify({ success: false, message: 'File not found or expired.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const stats = await fs.stat(cacheEntry.filePath);
    return new Response(JSON.stringify({ success: true, fileSize: stats.size }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error(`Error getting file size for ${fileId}:`, error);
    return new Response(JSON.stringify({ success: false, message: `Failed to get file size: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
