// Supabase Edge Function: increment-access-and-cleanup with logging
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

serve(async (req) => {
  console.log("--- Edge Function: increment-access-and-cleanup ---");
  console.log("Request URL:", req.url);
  console.log("Request Headers:");
  for (const [k, v] of req.headers.entries()) {
    console.log(`  ${k}: ${v}`);
  }
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId");
  console.log("jobId received:", jobId);
  if (!jobId) {
    console.log("Missing jobId in request");
    return new Response(JSON.stringify({ error: "Missing jobId" }), { status: 400 });
  }
  // Supabase env vars
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  console.log("SUPABASE_URL:", supabaseUrl);
  console.log("SUPABASE_SERVICE_ROLE_KEY present:", !!supabaseServiceRoleKey);
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  // 1. Get job info
  const { data: job, error } = await supabase.from("processing_jobs").select("access_count, file_name, public_url").eq("id", jobId).single();
  console.log("Supabase job query result:", { job, error });
  if (error || !job) {
    console.log("Job not found for jobId:", jobId);
    return new Response(JSON.stringify({ error: "Job not found" }), { status: 404 });
  }
  // 2. Increment access_count
  const newAccessCount = job.access_count + 1;
  if (newAccessCount <= 3) {
    const { error: updateError } = await supabase.from("processing_jobs").update({ access_count: newAccessCount }).eq("id", jobId);
    console.log(`Incremented access_count to ${newAccessCount} for jobId ${jobId}. Update error:`, updateError);
    return new Response(JSON.stringify({ success: true, access_count: newAccessCount }));
  }
  // 3. Delete file from storage and DB, log deletion
  let bucket = "processed-pdfs";
  let filePath = job.file_name;
  const match = job.public_url?.match(/public\/([^/]+)\/(.+)$/) || job.public_url?.match(/public\/([^/]+)\/(.+)/);
  if (match && match.length === 3) {
    bucket = match[1];
    filePath = match[2];
  }
  console.log(`Deleting file from storage: bucket=${bucket}, filePath=${filePath}`);
  const { error: storageError } = await supabase.storage.from(bucket).remove([filePath]);
  console.log("Storage delete error:", storageError);
  // Log deletion
  const logObj = {
    job_id: jobId,
    deleted_at: new Date().toISOString(),
  file_name: job.file_name,
    file_url: job.public_url
  };
  const { error: logError } = await supabase.from("deleted_jobs_log").insert(logObj);
  console.log("Logged deletion:", logObj, "Error:", logError);
  // Delete from DB
  const { error: dbDeleteError } = await supabase.from("processing_jobs").delete().eq("id", jobId);
  console.log("Deleted job from DB. Error:", dbDeleteError);
  return new Response(JSON.stringify({ success: true, deleted: true }));
});
