// src/app/api/list-processed-files/route.js

import { processedFilesCache, getOverallProcessingStatus } from '@/lib/fileCache';

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
        toolId: fileEntry.toolId 
      });
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
