// src/app/api/file-size/route.js

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// --- Supabase Configuration ---
// Retrieve the Supabase URL and public anon key from environment variables.
// These are accessed via process.env.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Check if environment variables are set to prevent runtime errors.
if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase URL or Key not found in environment variables.');
  // This will prevent the API route from running if secrets are missing.
  // In a production environment, you would want to ensure these are set.
}

const supabase = createClient(supabaseUrl, supabaseKey);

// --- CORS Headers Definition ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
// --- End CORS Headers Definition ---

// These exports are specific to Next.js App Router for serverless functions
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Handles the OPTIONS request for CORS preflight.
 * @returns {Response}
 */
export async function OPTIONS() {
  return NextResponse.json({}, { status: 204, headers: corsHeaders });
}

/**
 * Handles the GET request to retrieve the size of a processed file from Supabase.
 * @param {Request} request - The incoming request object.
 * @returns {Promise<Response>} - A promise that resolves with the API response.
 */
export async function GET(request) {
  try {
    // If the Supabase client couldn't be created due to missing env variables,
    // return an immediate error response.
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Server configuration error: Supabase keys are missing.' }, {
        status: 500,
        headers: corsHeaders,
      });
    }

    // Get the fileId from the request's URL search parameters.
    const { searchParams } = new URL(request.url);
    const fileId = searchParams.get('fileId');

    // Validate that a fileId was provided.
    if (!fileId) {
      return NextResponse.json({ error: 'Missing fileId query parameter.' }, {
        status: 400, // Bad Request
        headers: corsHeaders,
      });
    }

    // Query the Supabase database for the file size using the job id from the processing_jobs table.
    const { data, error } = await supabase
      .from('processing_jobs')
      .select('file_size')
      .eq('id', fileId)
      .single();

    // Handle any errors that occurred during the database query.
    if (error) {
      console.error('Supabase query error:', error);
      // Return a 404 if no record was found, otherwise a 500 for other errors.
      const status = error.code === 'PGRST116' ? 404 : 500;
      const message = error.code === 'PGRST116' ? `File with ID '${fileId}' not found.` : 'Internal Server Error';
      return NextResponse.json({ error: message }, {
        status: status,
        headers: corsHeaders,
      });
    }

    // Return only file size in MB rounded to nearest integer
    const fileSizeBytes = data?.file_size ?? null;
    const file_size_mb = fileSizeBytes != null ? Math.round(fileSizeBytes / (1024 * 1024)) : null;
    return NextResponse.json({ file_size_mb }, {
      status: 200, // OK
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Unexpected error in file-size GET handler:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, {
      status: 500, // Internal Server Error
      headers: corsHeaders,
    });
  }
}
