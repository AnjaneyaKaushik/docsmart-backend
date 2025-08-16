// src/app/api/process-pdf/route.js

import { v4 as uuidv4 } from 'uuid';
import { NextResponse } from 'next/server';

// Supabase helpers
import { addProcessingJob, getJobStatus, uploadRawInputFile, getQueueStatus } from '@/lib/supabaseService';

// These exports are specific to Next.js App Router for serverless functions
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// --- CORS Headers Definition ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
// --- End CORS Headers Definition ---

// Define an average job processing time for estimation (in seconds)
const AVERAGE_JOB_TIME_SECONDS = 30; 

/**
 * GET handler to check job status.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return new Response(JSON.stringify({ success: false, message: 'Job ID not provided.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const { job, error } = await getJobStatus(jobId);

  if (error || !job) {
    return new Response(JSON.stringify({ status: 'not found', error: error?.message || 'Job not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  const responseData = {
    status: job.status,
    progress: job.progress ?? null,
    outputFileName: job.file_name ?? null,
    downloadLink: `/api/download-proxied-file?jobId=${jobId}`,
    error: job.error_message ?? null,
  };

  return new Response(JSON.stringify(responseData), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/**
 * OPTIONS handler for CORS preflight requests.
 */
export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

/**
 * POST handler to create a new PDF processing job.
 */
export async function POST(request) {
  const jobId = uuidv4();

  try {
    const formData = await request.formData();
    const toolId = formData.get('toolId');
    const files = formData.getAll('files');
    const options = JSON.parse(formData.get('options') || '{}');

    if (!toolId || files.length === 0) {
      return new Response(JSON.stringify({ success: false, message: 'toolId and at least one file are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    console.log(`Received job request for tool: ${toolId}, files: ${files.length}, Job ID: ${jobId}`);

    const inputFilePaths = [];
    for (const file of files) {
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      const { storagePath, error } = await uploadRawInputFile(jobId, buffer, file.name, file.type);

      if (error) {
        throw new Error(`Failed to upload raw file: ${file.name}. Reason: ${error.message}`);
      }
      inputFilePaths.push(storagePath);
    }

    const { jobId: newJobId, error: dbError } = await addProcessingJob(toolId, inputFilePaths, options);

    if (dbError) {
      throw new Error(`Failed to create job in database. Reason: ${dbError.message}`);
    }

    // Get queue status for estimated time
    const { pendingJobs, inProgressJobs, error: queueError } = await getQueueStatus();
    let queuePosition = 0;
    let estimatedWaitTime = 0;

    if (!queueError) {
      // If there's an in-progress job, this new job is at least 1st in queue
      // If there are pending jobs, add them to the queue position
      queuePosition = inProgressJobs + pendingJobs;
      estimatedWaitTime = queuePosition * AVERAGE_JOB_TIME_SECONDS;
    }

    const responsePayload = {
      success: true,
      isProcessing: true,
      jobId: newJobId,
      statusCheckLink: `/api/process-pdf?jobId=${newJobId}`,
      message: 'Processing job has been created. Please poll the status endpoint for updates.',
      queuePosition: queuePosition > 0 ? queuePosition : null,
      estimatedWaitTimeSeconds: estimatedWaitTime > 0 ? estimatedWaitTime : null,
    };

    return new Response(JSON.stringify(responsePayload), {
      status: 202, // 202 Accepted
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (error) {
    console.error('Error creating processing job:', error);
    return new Response(JSON.stringify({ success: false, message: error.message || 'An unknown error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
