// src/lib/supabaseService.js

import { createClient } from '@supabase/supabase-js';

let supabase;

export function getSupabaseClient() {
  if (!supabase) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase URL and Service Role key are required. Please check your environment variables.");
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return supabase;
}

// --- Cleanup Service Constants ---
const CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 minutes
const EXPIRY_TIME = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_ID_KEY = 'global_supabase_cleanup_interval_id';
// --- End Cleanup Service Constants ---

/**
 * Adds a new processing job to the Supabase database.
 * @param {string} toolId The tool being used.
 * @param {string[]} inputFilePaths Array of paths to the input files in Supabase Storage.
 * @param {object} options The options for the processing job.
 * @returns {Promise<{jobId: string, error: object}>} The ID of the new job or an error object.
 */
export async function addProcessingJob(toolId, inputFilePaths, options) {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from('processing_jobs')
      .insert([
        {
          tool_id: toolId,
          status: 'pending',
          progress: 0,
          input_file_paths: inputFilePaths,
          options: options,
        }
      ])
      .select('id')
      .single();

    if (error) {
      console.error('Error adding processing job:', error);
      return { jobId: null, error };
    }

    return { jobId: data.id, error: null };

  } catch (err) {
    console.error('Unexpected error in addProcessingJob:', err);
    return { jobId: null, error: err };
  }
}

/**
 * Updates the status and progress of an existing processing job.
 * @param {string} jobId The ID of the job to update.
 * @param {string} status The new status ('pending' | 'in_progress' | 'succeeded' | 'failed').
 * @param {number} progress The new progress percentage (0-100).
 * @param {string} fileName The name of the final output file (optional).
 * @param {string} publicUrl The public URL of the uploaded file (optional).
 * @param {string} errorMessage A message describing an error if one occurred (optional).
 * @returns {Promise<{success: boolean, error: object}>}
 */
export async function updateProcessingJobStatus(jobId, status, progress = null, fileName = null, publicUrl = null, errorMessage = null) {
  const supabase = getSupabaseClient();
  try {
    const updateData = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (progress !== null) updateData.progress = progress;
    if (fileName !== null) updateData.file_name = fileName;
    if (publicUrl !== null) updateData.public_url = publicUrl;
    if (errorMessage !== null) updateData.error_message = errorMessage;


    const { error } = await supabase
      .from('processing_jobs')
      .update(updateData)
      .eq('id', jobId);

    if (error) {
      console.error('Error updating processing job status:', error);
      return { success: false, error };
    }
    return { success: true, error: null };
  } catch (err) {
    console.error('Unexpected error in updateProcessingJobStatus:', err);
    return { success: false, error: err };
  }
}

/**
 * Increments the access count for a job, and deletes the file/job if access count >= 3.
 * @param {string} jobId The job ID.
 * @returns {Promise<{deleted: boolean, error: object}>}
 */
export async function incrementAccessCountAndCleanup(jobId) {
  const supabase = getSupabaseClient();
  try {
    console.log('incrementAccessCountAndCleanup called for jobId:', jobId);
    // Get current access count
    const { data: job, error: fetchError } = await supabase
      .from('processing_jobs')
      .select('access_count, file_name, public_url')
      .eq('id', jobId)
      .single();
    console.log('Fetched job for increment:', job);
    if (fetchError || !job) {
      console.error('Job not found or fetch error:', fetchError);
      return { deleted: false, error: fetchError || new Error('Job not found') };
    }
    const newAccessCount = (job.access_count || 0) + 1;
    if (newAccessCount >= 3) {
      // Delete file and job
      await deleteProcessingJobAndFile(jobId);
      console.log('Deleted job after reaching max accesses:', jobId);
      return { deleted: true, error: null };
    } else {
      // Just increment access_count
      const { data: updated, error: updateError } = await supabase
        .from('processing_jobs')
        .update({ access_count: newAccessCount })
        .eq('id', jobId)
        .select('access_count')
        .single();
      if (updateError) {
        console.error('Error incrementing access_count:', updateError);
        return { deleted: false, error: updateError };
      }
      if (!updated) {
        console.error('Update succeeded but no updated row returned for jobId:', jobId);
      } else {
        console.log('Updated access_count for job', jobId, 'to', updated.access_count);
      }
      return { deleted: false, error: null };
    }
  } catch (err) {
    return { deleted: false, error: err };
  }
}

/**
 * Uploads a raw input file to Supabase Storage.
 * @param {string} jobId The ID of the job associated with the file.
 * @param {Buffer} fileBuffer The file content.
 * @param {string} fileName The original name of the file.
 * @param {string} mimeType The MIME type of the file.
 * @returns {Promise<{storagePath: string, error: object}>} The path to the file in storage or an error.
 */
export async function uploadRawInputFile(jobId, fileBuffer, fileName, mimeType) {
    const supabase = getSupabaseClient();
    try {
        const supabaseFilePath = `public/${jobId}/raw/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from('raw-inputs')
            .upload(supabaseFilePath, fileBuffer, {
                contentType: mimeType,
            });

        if (uploadError) {
            console.error('Error uploading raw file to Supabase Storage:', uploadError);
            return { storagePath: null, error: uploadError };
        }

        return { storagePath: supabaseFilePath, error: null };

    } catch (err) {
        console.error('Unexpected error in uploadRawInputFile:', err);
        return { storagePath: null, error: err };
    }
}


/**
 * Uploads a processed file to Supabase Storage and updates the job's URL.
 * @param {string} jobId The ID of the job associated with the file.
 * @param {Buffer} fileBuffer The processed file content.
 * @param {string} fileName The desired name for the file in storage.
 * @param {string} mimeType The MIME type of the file.
 * @returns {Promise<{publicUrl: string, error: object}>} The public URL of the uploaded file or an error object.
 */
export async function uploadProcessedFile(jobId, fileBuffer, fileName, mimeType) {
  const supabase = getSupabaseClient();
  try {
    // The path in Supabase Storage will be `public/jobId/fileName`
    const supabaseFilePath = `public/${jobId}/${fileName}`;
    const fileSize = fileBuffer.length; // file size in bytes

    // Upload the file to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('processed-pdfs')
      .upload(supabaseFilePath, fileBuffer, {
        contentType: mimeType,
      });

    if (uploadError) {
      console.error('Error uploading file to Supabase Storage:', uploadError);
      return { publicUrl: null, error: uploadError };
    }

    // Get the public URL for the uploaded file
    const { data: publicUrlData } = supabase.storage
      .from('processed-pdfs')
      .getPublicUrl(supabaseFilePath);

    if (!publicUrlData) {
      const getUrlError = new Error('Could not get public URL for uploaded file.');
      console.error(getUrlError);
      return { publicUrl: null, error: getUrlError };
    }

    // Store the file size (bytes) on the processing_jobs row for this job
    const fileSizeMb = Number((fileSize / (1024 * 1024)).toFixed(2));

    const { error: updateBytesError } = await supabase
      .from('processing_jobs')
      .update({ file_size: fileSize })
      .eq('id', jobId);

    if (updateBytesError != null) {
      console.error('Error updating file_size (bytes) in DB:', updateBytesError);
    }

    // Try to store MB if the column exists; ignore schema cache error
    const { error: updateMbError } = await supabase
      .from('processing_jobs')
      .update({ file_size_mb: fileSizeMb })
      .eq('id', jobId);

    if (updateMbError != null && updateMbError.code !== 'PGRST204') {
      console.error('Error updating file_size_mb in DB:', updateMbError);
    }

    return { publicUrl: publicUrlData.publicUrl, error: null };
  
  } catch (err) {
    console.error('Unexpected error in uploadProcessedFile:', err);
    return { publicUrl: null, error: err };
  }
}


/**
 * Fetches the status of a specific processing job.
 * @param {string} jobId The ID of the job to fetch.
 * @returns {Promise<{job: object, error: object}>} The job data or an error object.
 */
export async function getJobStatus(jobId) {
  const supabase = getSupabaseClient();
  try {
    const { data: job, error } = await supabase
      .from('processing_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is 'no rows found'
      console.error('Error fetching job status:', error);
      return { job: null, error };
    }

    return { job, error: null };

  } catch (err) {
    console.error('Unexpected error in getJobStatus:', err);
    return { job: null, error: err };
  }
}






/**
 * Fetches a pending job and locks it for processing.
 * @param {string} workerId The ID of the worker picking up the job.
 * @returns {Promise<{job: object, error: object}>} The job data or an error object.
 */
export async function getPendingJobAndLock(workerId) {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase.rpc('get_and_lock_pending_job', { worker_id: workerId });

    if (error) {
      console.error('Error getting and locking job:', error);
      return { job: null, error };
    }

    return { job: data, error: null };

  } catch (err) {
    console.error('Unexpected error in getPendingJobAndLock:', err);
    return { job: null, error: err };
  }
}

/**
 * Deletes a file from a specified Supabase Storage bucket.
 * @param {string} bucketName The name of the storage bucket (e.g., 'raw-inputs', 'processed-pdfs').
 * @param {string} filePath The full path to the file within the bucket (e.g., 'public/jobId/raw/fileName.pdf').
 * @returns {Promise<{success: boolean, error: object}>}
 */
export async function deleteFileFromStorage(bucketName, filePath) {
  const supabase = getSupabaseClient();
  try {
    const { error } = await supabase.storage
      .from(bucketName)
      .remove([filePath]);

    if (error) {
      console.error(`Error deleting file ${filePath} from bucket ${bucketName}:`, error);
      return { success: false, error };
    }
    return { success: true, error: null };
  } catch (err) {
    console.error('Unexpected error in deleteFileFromStorage:', err);
    return { success: false, error: err };
  }
}

/**
 * Deletes a processed file from Supabase Storage and the job from the database.
 * @param {string} jobId The ID of the job to delete.
 * @returns {Promise<{success: boolean, error: object}>}
 */
export async function deleteProcessingJobAndFile(jobId) {
  const supabase = getSupabaseClient();
  try {
    // Fetch job info to get file path
    const { data: job, error: fetchError } = await supabase
      .from('processing_jobs')
      .select('public_url, file_name')
      .eq('id', jobId)
      .single();

    if (fetchError || !job) {
      console.error(`Job with ID ${jobId} not found or error fetching it:`, fetchError);
      return { success: false, error: fetchError || new Error('Job not found') };
    }

    // Delete from storage if file info exists
    if (job.public_url && job.file_name) {
      const filePath = `public/${jobId}/${job.file_name}`;
      const { error: storageError } = await supabase
        .storage
        .from('processed-pdfs')
        .remove([filePath]);

      if (storageError) {
        console.error(`Error deleting file from Supabase Storage for job ${jobId}:`, storageError);
        // Continue deleting DB record even if file deletion fails
      }
    }

    // Delete DB record
    const { error: dbError } = await supabase
      .from('processing_jobs')
      .delete()
      .in('id', jobId);

    if (dbError) {
      console.error(`Error deleting job record from database for job ${jobId}:`, dbError);
      return { success: false, error: dbError };
    }

    return { success: true, error: null };

  } catch (err) {
    console.error('Unexpected error in deleteProcessingJobAndFile:', err);
    return { success: false, error: err };
  }
}

/**
 * Fetches the count of pending and in-progress jobs.
 * @returns {Promise<{pendingJobs: number, inProgressJobs: number, error: object}>}
 */
export async function getQueueStatus() {
  const supabase = getSupabaseClient();
  try {
    const { count: pendingCount, error: pendingError } = await supabase
      .from('processing_jobs')
      .select('id', { count: 'exact' })
      .eq('status', 'pending');

    if (pendingError) {
      console.error('Error fetching pending job count:', pendingError);
      return { pendingJobs: 0, inProgressJobs: 0, error: pendingError };
    }

    const { count: inProgressCount, error: inProgressError } = await supabase
      .from('processing_jobs')
      .select('id', { count: 'exact' })
      .eq('status', 'in_progress');

    if (inProgressError) {
      console.error('Error fetching in-progress job count:', inProgressError);
      return { pendingJobs: 0, inProgressJobs: 0, error: inProgressError };
    }

    return { pendingJobs: pendingCount, inProgressJobs: inProgressCount, error: null };

  } catch (err) {
    console.error('Unexpected error in getQueueStatus:', err);
    return { pendingJobs: 0, inProgressJobs: 0, error: err };
  }
}