// src/app/api/pdf-to-jpg-pages/route.js
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import { pdf2img } from '@pdfme/converter'; // Import pdf2img
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

  if (cacheEntry.mimeType !== 'application/pdf') {
    return new Response(JSON.stringify({ success: false, message: 'Only PDF files can be converted to JPG pages.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  let tempJpgDir;
  const imageUrls = [];

  try {
    const pdfBuffer = await fs.readFile(cacheEntry.filePath);
    const pdfUint8Arrays = new Uint8Array(pdfBuffer);

    // Convert PDF pages to images
    const images = await pdf2img(pdfUint8Arrays);

    if (images.length === 0) {
      throw new Error('Could not extract images from PDF.');
    }

    // Create a temporary directory to store JPGs
    tempJpgDir = path.join(os.tmpdir(), `pdf_pages_${uuidv4()}`);
    await fs.mkdir(tempJpgDir, { recursive: true });

    for (let i = 0; i < images.length; i++) {
      const imageFileName = `page_${i + 1}.jpg`;
      const imageFilePath = path.join(tempJpgDir, imageFileName);
      await fs.writeFile(imageFilePath, Buffer.from(images[i]));
      // Return a temporary URL for the image
      // In a real production environment, you'd serve these via a dedicated static file server
      // For this example, we'll use a placeholder URL that implies it's served temporarily
      imageUrls.push(`/api/temp-image?path=${encodeURIComponent(imageFilePath)}`);
    }

    // Store the temporary directory path in the cache entry for later cleanup
    // This is a simplified approach. In a robust system, you'd have a more sophisticated cleanup mechanism.
    cacheEntry.tempJpgDir = tempJpgDir;
    processedFilesCache.set(fileId, cacheEntry); // Update cache entry

    return new Response(JSON.stringify({ success: true, pages: imageUrls }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (error) {
    console.error('Error converting PDF to JPG pages:', error);
    // Attempt to clean up temp directory on error
    if (tempJpgDir) {
      await fs.rm(tempJpgDir, { recursive: true, force: true }).catch(console.error);
    }
    return new Response(JSON.stringify({ success: false, message: `Failed to extract PDF pages: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
