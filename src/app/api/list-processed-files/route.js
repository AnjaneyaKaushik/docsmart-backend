// This is the complete file for the list-processed-files endpoint, using Supabase.

// Import necessary modules
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// These exports are specific to Next.js App Router for serverless functions
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// --- CORS Headers Definition ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
// --- End CORS Headers Definition ---

// Initialize the Supabase client
// We use environment variables for security and portability.
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Used for a user-agnostic update

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseService = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Handles the OPTIONS preflight request for CORS.
 * @param {Request} req The incoming request object.
 * @returns {Response} An empty response with the appropriate CORS headers.
 */
export async function OPTIONS(req) {
  return new Response(null, {
    status: 204, // No Content
    headers: corsHeaders,
  });
}

/**
 * Handles GET requests to list all processed files from the Supabase database.
 * This endpoint queries the 'processed_files' table with the specified column names.
 * @param {Request} req The incoming request object.
 * @returns {Response} A JSON response containing the list of processed files.
 */
export async function GET(req) {
  try {
    console.log('Received request to list processed files from Supabase.');
    
    // Query the 'processing_jobs' table with the correct column names.
    const { data, error } = await supabase
      .from('processing_jobs')
      .select('id, file_name, tool_id, public_url, created_at, updated_at, access_count, progress, status');

    if (error) {
      console.error('Supabase query error:', error);
      throw new Error('Failed to retrieve files from database.');
    }

    // Map the Supabase data to a consistent API response format.
    const filesList = data.map(file => ({
      fileId: file.id,
      fileName: file.file_name,
      toolId: file.tool_id,
      timestamp: file.created_at, // Use created_at as the initial timestamp
      accessCount: file.access_count,
      status: file.status,
      progress: file.progress,
      filePath: file.public_url, // Use the public_url as the file path
      downloadApiLink: `/api/download-proxied-file?jobId=${file.id}&fileName=${encodeURIComponent(file.file_name)}`
    }));

    console.log(`Found ${filesList.length} processed files in Supabase.`);

    // Return the list of files as a JSON response
    return NextResponse.json(filesList, {
      status: 200,
      headers: corsHeaders,
    });

  } catch (error) {
    console.error('Error listing processed files:', error.message);
    // Return a 500 status with a generic error message
    return NextResponse.json({ error: 'Failed to list processed files' }, {
      status: 500,
      headers: corsHeaders,
    });
  }
}

/**
 * Handles PATCH requests to update a file's access count and update timestamp.
 * @param {Request} req The incoming request object.
 * @returns {Response} A JSON response with a success message or an error.
 */
export async function PATCH(req) {
  try {
    const { fileId } = await req.json();

    if (!fileId) {
      return NextResponse.json({ error: 'fileId is required' }, { status: 400, headers: corsHeaders });
    }

    // Use the service role key to bypass RLS, ensuring we can always update the record.
    // Increment access_count using arithmetic update
    const { data: current, error: fetchError } = await supabaseService
      .from('processing_jobs')
      .select('access_count')
      .eq('id', fileId)
      .single();

    if (fetchError || !current) {
      return NextResponse.json({ error: 'File not found' }, { status: 404, headers: corsHeaders });
    }

    const newAccessCount = (current.access_count || 0) + 1;
    const { data, error } = await supabaseService
      .from('processing_jobs')
      .update({ 
        access_count: newAccessCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', fileId)
      .select();

    if (error) {
      console.error('Supabase update error:', error);
      throw new Error('Failed to update file record.');
    }
    
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'File not found' }, { status: 404, headers: corsHeaders });
    }

    console.log(`Updated access count for file: ${fileId}`);
    return NextResponse.json({ message: 'File access count updated successfully' }, { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error('Error updating processed file:', error.message);
    return NextResponse.json({ error: 'Failed to update file access' }, {
      status: 500,
      headers: corsHeaders,
    });
  }
}
