// src/app/api/list-processed-files/route.js

import { processedFilesCache } from '@/lib/fileCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error listing processed files:', error);
    return new Response(JSON.stringify({ success: false, message: `Server error: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}