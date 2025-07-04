// src/app/api/download-processed-file/route.js
// src/app/api/download-processed-file/route.js
import { promises as fs } from 'fs';
import { processedFilesCache } from '@/lib/fileCache'; // Import the cache

    export const dynamic = 'force-dynamic'; // Ensures the route is not cached
    export const runtime = 'nodejs'; // Essential for using Node.js APIs like 'fs'

    export async function GET(request) {
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
        return new Response(JSON.stringify({ success: false, message: 'File not found or has expired.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      try {
        const fileBuffer = await fs.readFile(fileEntry.filePath);

        // Clean up the file immediately after serving it once
        // This is a "single-use" download URL.
        try {
          await fs.unlink(fileEntry.filePath);
          processedFilesCache.delete(fileId);
          console.log(`Successfully served and cleaned up file: ${fileEntry.filePath}`);
        } catch (cleanupError) {
          console.error(`Error cleaning up file after download ${fileEntry.filePath}:`, cleanupError);
        }

        return new Response(fileBuffer, {
          status: 200,
          headers: {
            'Content-Type': fileEntry.mimeType,
            'Content-Disposition': `attachment; filename="${fileEntry.fileName}"`,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate', // Prevent caching
            'Pragma': 'no-cache',
            'Expires': '0',
          },
        });
      } catch (error) {
        console.error(`Error serving file ${fileId}:`, error);
        return new Response(JSON.stringify({ success: false, message: `Server error: ${error.message}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    