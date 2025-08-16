// src/app/api/delete-processed-file/route.js

import { deleteProcessingJobAndFile } from '@/lib/supabaseService';

// --- CORS Headers Definition ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
// --- End CORS Headers Definition ---

export async function DELETE(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return new Response(JSON.stringify({ message: 'Missing jobId parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const { success, error } = await deleteProcessingJobAndFile(jobId);

  if (success) {
    return new Response(JSON.stringify({ message: 'File and job record deleted successfully.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } else {
    return new Response(JSON.stringify({ message: `Failed to delete file and job: ${error?.message || 'Unknown error'}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
