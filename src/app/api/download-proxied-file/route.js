// src/app/api/download-proxied-file/route.js

import { getJobStatus } from '@/lib/supabaseService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function GET(request) {

  let { searchParams } = new URL(request.url);
  let jobId = searchParams.get('jobId');
  let fileName = searchParams.get('fileName');

  // Workaround for incorrectly encoded URLs where '?' is encoded as '%3F'
  if (!jobId && request.url.includes('%3F')) {
    const urlParts = request.url.split('%3F');
    if (urlParts.length > 1) {
      const newQueryString = urlParts[1];
      searchParams = new URLSearchParams(newQueryString);
      jobId = searchParams.get('jobId');
      fileName = searchParams.get('fileName');
    }
  }

  if (!jobId) {
    return new Response(JSON.stringify({ success: false, message: 'Job ID not provided.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Explicitly check for job existence and get public_url
  const { job, error } = await getJobStatus(jobId);
  if (error || !job || !job.public_url) {
    return new Response(JSON.stringify({ success: false, message: 'File not found or job missing public_url.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Call the edge function to increment access and cleanup
  try {
    const edgeUrl = process.env.EDGE_FUNCTION_URL || process.env.NEXT_PUBLIC_EDGE_FUNCTION_URL;
    if (!edgeUrl) throw new Error('EDGE_FUNCTION_URL not set');
    const edgeEndpoint = `${edgeUrl}?jobId=${jobId}`;
    // Forward the user's Authorization header if present, else use anon key
    let authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
    if (!authHeader) {
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseAnonKey) {
        console.error('SUPABASE_ANON_KEY is missing in environment variables!');
        return new Response(JSON.stringify({ success: false, message: 'SUPABASE_ANON_KEY not set in environment.' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      authHeader = `Bearer ${supabaseAnonKey}`;
    }

    const edgeResp = await fetch(edgeEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
      },
    });
    if (!edgeResp.ok) {
      const err = await edgeResp.text();
      console.error('Edge function error (download-proxied-file):', err);
      return new Response(JSON.stringify({ success: false, message: 'Edge function error', error: err }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
    const edgeData = await edgeResp.json();
    if (edgeData.deleted) {
      return new Response(JSON.stringify({ success: false, message: 'File has expired or reached max accesses.' }), {
        status: 410,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  } catch (err) {
    return new Response(JSON.stringify({ success: false, message: 'Edge function call failed', error: err?.message || err }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Fetch the file from the CDN link to stream it back
  const fileResponse = await fetch(job.public_url);

  if (!fileResponse.ok) {
    return new Response(JSON.stringify({ success: false, message: 'Failed to fetch file from storage.' }), {
      status: fileResponse.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Create new headers for the response, copying from the original file response
  const headers = new Headers(corsHeaders);
  headers.set('Content-Type', fileResponse.headers.get('Content-Type') || 'application/octet-stream');
  headers.set('Content-Length', fileResponse.headers.get('Content-Length'));

  // Set the filename for download
  const finalFileName = fileName || job.file_name || 'downloaded-file';
  headers.set('Content-Disposition', `attachment; filename="${finalFileName}"`);

  // Stream the file body
  return new Response(fileResponse.body, {
    status: 200,
    headers: headers,
  });
}

export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}