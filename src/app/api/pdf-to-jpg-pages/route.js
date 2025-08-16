// src/app/api/pdf-to-jpg-pages/route.js
import { v4 as uuidv4 } from 'uuid';
import { pdf2img } from '@pdfme/converter';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// These exports are specific to Next.js App Router for serverless functions
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// --- CORS Headers Definition ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
// --- End CORS Headers Definition ---

// Initialize the Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Handles the OPTIONS preflight request for CORS.
 * @param {Request} request The incoming request object.
 * @returns {Response} An empty response with the appropriate CORS headers.
 */
export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * Handles GET requests to convert a PDF to a series of JPG pages.
 * The function fetches the PDF from Supabase storage, converts it to images,
 * uploads the images to a 'temp-images' bucket, and returns their public URLs.
 * @param {Request} request The incoming request object.
 * @returns {Response} A JSON response containing the list of public image URLs or an error message.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get('id');

  if (!fileId) {
    return new Response(JSON.stringify({ success: false, message: 'File ID is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const imageUrls = [];

  try {
    // 1. Fetch the file record from Supabase based on the ID.
    const { data: fileRecord, error: fileError } = await supabase
      .from('processed_files')
      .select('public_url, status')
      .eq('id', fileId)
      .single();

    if (fileError || !fileRecord) {
      console.error('Supabase query error or file not found:', fileError);
      return new Response(JSON.stringify({ success: false, message: 'File not found or expired.' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (fileRecord.status !== 'completed') {
      return new Response(JSON.stringify({ success: false, message: 'File is not yet completed.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    
    // 2. Fetch the PDF content from the public URL.
    const response = await fetch(fileRecord.public_url);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF from URL: ${response.statusText}`);
    }
    const pdfBuffer = Buffer.from(await response.arrayBuffer());

    // Basic check to confirm the file is a PDF
    if (pdfBuffer[0] !== 0x25 || pdfBuffer[1] !== 0x50 || pdfBuffer[2] !== 0x44 || pdfBuffer[3] !== 0x46) {
        throw new Error('The fetched file is not a valid PDF.');
    }

    // 3. Convert PDF pages to images.
    const pdfUint8Arrays = new Uint8Array(pdfBuffer);
    const images = await pdf2img(pdfUint8Arrays);

    if (images.length === 0) {
      throw new Error('Could not extract images from PDF.');
    }
    
    // 4. Upload each image to Supabase Storage and collect the public URLs.
    const uploadPromises = images.map(async (image, index) => {
      const imageFileName = `page_${fileId}_${index + 1}.jpg`;
      const filePathInStorage = `pdf-pages/${imageFileName}`;
      
      const { data, error } = await supabase.storage
        .from('temp-images') // Assumes you have a 'temp-images' bucket
        .upload(filePathInStorage, Buffer.from(image), {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (error) {
        console.error(`Error uploading image page ${index + 1}:`, error);
        throw new Error(`Failed to upload image page ${index + 1}`);
      }
      
      // Get the public URL for the uploaded image
      const { data: publicUrlData } = supabase.storage
        .from('temp-images')
        .getPublicUrl(filePathInStorage);

      return publicUrlData.publicUrl;
    });

    const results = await Promise.allSettled(uploadPromises);
    results.forEach(result => {
        if (result.status === 'fulfilled') {
            imageUrls.push(result.value);
        } else {
            // Handle rejected promises if needed, though the promise chain above
            // already throws on upload error.
            console.error('An image upload promise was rejected:', result.reason);
        }
    });

    return new Response(JSON.stringify({ success: true, pages: imageUrls }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (error) {
    console.error('Error converting PDF to JPG pages:', error);
    return new Response(JSON.stringify({ success: false, message: `Failed to extract PDF pages: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
