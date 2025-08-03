// src/app/api/temp-image/route.js
import fs from 'fs/promises';
import path from 'path';
import os from 'os'; // Import os for tmpdir

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
  const filePath = searchParams.get('path');

  if (!filePath) {
    return new Response(JSON.stringify({ success: false, message: 'File path is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Basic security: Ensure the path is within a temporary directory
  // In a real application, you'd want more robust validation and access control
  if (!filePath.startsWith(os.tmpdir())) {
     return new Response(JSON.stringify({ success: false, message: 'Invalid file path.' }), {
       status: 403, // Forbidden
       headers: { 'Content-Type': 'application/json', ...corsHeaders },
     });
  }


  try {
    const fileBuffer = await fs.readFile(filePath);
    const mimeType = 'image/jpeg'; // Assuming all temporary images are JPEGs

    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': fileBuffer.length.toString(),
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error(`Error serving temporary image ${filePath}:`, error);
    return new Response(JSON.stringify({ success: false, message: `Failed to retrieve image: ${error.message}` }), {
      status: 404, // Not Found or Internal Server Error
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
