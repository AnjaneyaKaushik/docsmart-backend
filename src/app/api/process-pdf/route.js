// src/app/api/process-pdf/route.js


import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import archiver from 'archiver';
import { exec, spawn, execSync } from 'child_process';
import os from 'os';
import { NextResponse } from 'next/server';

// Importing the cache and job management functions
import { processedFilesCache, startCleanupService, addProcessingJob, updateProcessingJobStatus, removeProcessingJob, processingJobs } from '@/lib/fileCache'; 

import { img2pdf, pdf2img } from '@pdfme/converter';
import { merge, split, rotate, remove } from '@pdfme/manipulator'; 

// Start the cleanup service to manage temporary files
startCleanupService();

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

/**
 * Appends a single-page PDF to the end of an existing PDF.
 * @param {Buffer} existingPdfBuffer - Buffer of the existing PDF.
 * @param {Buffer} pagePdfBuffer - Buffer of the single-page PDF to append.
 * @returns {Promise<Buffer>} - Buffer of the merged PDF.
 */
async function appendPageToPdf(existingPdfBuffer, pagePdfBuffer) {
  // Uses the merge function from @pdfme/manipulator
  return await merge([existingPdfBuffer, pagePdfBuffer]);
}


/**
 * Saves a file from a FormData object to the local temporary directory.
 * @param {File} file The file object from the FormData.
 * @returns {Promise<{filepath: string, originalFilename: string, mimetype: string}>} The details of the saved file.
 */
async function saveFileLocally(file) {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);      

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const extension = path.extname(file.name);
  const baseName = path.basename(file.name, extension);
  const filename = `${baseName}-${uniqueSuffix}${extension}`;
  const filepath = path.join(os.tmpdir(), filename); // Use os.tmpdir() for temporary files

  await fs.writeFile(filepath, buffer);
  
  return {
    filepath,
    originalFilename: file.name,
    mimetype: file.type,
  };
}


/**
 * Helper function to process a PDF to Word conversion using a Python script.
 * @param {{filepath: string, originalFilename: string}} file The input PDF file.
 * @returns {Promise<{processedBuffer: Buffer, processedFileName: string, processedMimeType: string, outputFilePath: string}>} The result of the conversion.
 */
async function processPdfToWordWithPython(file) {
  const uniqueId = uuidv4();
  const outputDir = path.join(os.tmpdir(), `pdf_word_py_output_${uniqueId}`);
  await fs.mkdir(outputDir, { recursive: true });

  const outputFileName = `${path.basename(file.originalFilename, path.extname(file.originalFilename))}_converted.docx`;
  const outputFilePath = path.join(outputDir, outputFileName);

  return new Promise((resolve, reject) => {
    const pythonScriptPath = path.join(process.cwd(), 'scripts', 'convert_pdf_to_docx.py');
    const pythonProcess = spawn('python3', [ 
      pythonScriptPath,
      file.filepath,
      outputFilePath
    ]);

    let stderrOutput = '';
    pythonProcess.stderr.on('data', (data) => {
      stderrOutput += data.toString();
      console.error(`Python stderr (pdf2docx): ${data}`);
    });

    pythonProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          const processedBuffer = await fs.readFile(outputFilePath);
          resolve({
            processedBuffer,
            processedFileName: outputFileName,
            processedMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            outputFilePath: outputFilePath 
          });
        } catch (readError) {
          await fs.rm(outputDir, { recursive: true, force: true }).catch(console.error);
          reject(new Error(`Failed to read converted DOCX file: ${readError.message}`));
        }
      } else {
        await fs.rm(outputDir, { recursive: true, force: true }).catch(console.error);
        reject(new Error(`PDF to Word conversion failed (Python script exited with code ${code}). Stderr: ${stderrOutput}`));
      }
    });

    pythonProcess.on('error', (err) => {
      console.error('Failed to start Python subprocess (pdf2docx):', err);
      reject(new Error(`Failed to start Python conversion process: ${err.message}. Is Python installed and in PATH?`));
    });
  });
}


/**
 * Helper function to repair a PDF using a Python script (pikepdf).
 * @param {{filepath: string, originalFilename: string}} file The input PDF file.
 * @returns {Promise<{processedBuffer: Buffer, processedFileName: string, processedMimeType: string, outputFilePath: string}>} The result of the repair.
 */
async function processRepairPdfWithPython(file) {
  const uniqueId = uuidv4();
  const outputDir = path.join(os.tmpdir(), `repair_pdf_py_output_${uniqueId}`);
  await fs.mkdir(outputDir, { recursive: true });

  const outputFileName = `${path.basename(file.originalFilename, path.extname(file.originalFilename))}_repaired.pdf`;
  const outputFilePath = path.join(outputDir, outputFileName);

  return new Promise((resolve, reject) => {
    const pythonScriptPath = path.join(process.cwd(), 'scripts', 'repair_pdf_pikepdf.py');
    const pythonProcess = spawn('python3', [
      pythonScriptPath,
      file.filepath,
      outputFilePath
    ]);

    let stderrOutput = '';
    pythonProcess.stderr.on('data', (data) => {
      stderrOutput += data.toString();
      console.error(`Python stderr (pikepdf): ${data}`);
    });

    pythonProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          const processedBuffer = await fs.readFile(outputFilePath);
          resolve({
            processedBuffer,
            processedFileName: outputFileName,
            processedMimeType: 'application/pdf',
            outputFilePath: outputFilePath 
          });
        } catch (readError) {
          await fs.rm(outputDir, { recursive: true, force: true }).catch(console.error);
          reject(new Error(`Failed to read repaired PDF file: ${readError.message}`));
        }
      } else {
        await fs.rm(outputDir, { recursive: true, force: true }).catch(console.error);
        reject(new Error(`PDF repair failed (Python script exited with code ${code}). Stderr: ${stderrOutput}`));
      }
    });

    pythonProcess.on('error', (err) => {
      console.error('Failed to start Python subprocess (pikepdf):', err);
      reject(new Error(`Failed to start Python repair process: ${err.message}. Is Python installed and in PATH?`));
    });
  });
}

/**
 * Helper function for PDF protection/unlocking using a Python script.
 * @param {string} action The action to perform ('protect' or 'unlock').
 * @param {{filepath: string}} file The input PDF file.
 * @param {string} password The password for the PDF.
 * @returns {Promise<{processedBuffer: Buffer, processedFileName: string, processedMimeType: string, outputFilePath: string}>} The result of the operation.
 */
async function processPdfSecurityWithPython(action, file, password) {
  const uniqueId = uuidv4();
  const outputFileName = `${action}_${uuidv4()}.pdf`;
  const outputFilePath = path.join(os.tmpdir(), outputFileName);

  return new Promise((resolve, reject) => {
    const pythonScriptPath = path.join(process.cwd(), 'scripts', 'protect_pdf.py');
    const pythonProcess = spawn('python3', [
      pythonScriptPath,
      action,
      file.filepath,
      outputFilePath,
      password || ''
    ]);

    let stderrOutput = '';
    pythonProcess.stderr.on('data', (data) => {
      stderrOutput += data.toString();
      console.error(`Python stderr (${action}_pdf.py): ${data}`);
    });

    pythonProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          const processedBuffer = await fs.readFile(outputFilePath);
          resolve({
            processedBuffer,
            processedFileName: outputFileName,
            processedMimeType: 'application/pdf',
            outputFilePath: outputFilePath 
          });
        } catch (readError) {
          await fs.rm(outputFilePath, { force: true }).catch(console.error);
          reject(new Error(`Failed to read processed PDF file: ${readError.message}`));
        }
      } else {
        await fs.rm(outputFilePath, { force: true }).catch(console.error);
        reject(new Error(`PDF ${action} failed (Python script exited with code ${code}). Stderr: ${stderrOutput}`));
      }
    });

    pythonProcess.on('error', (err) => {
      console.error(`Failed to start Python subprocess (${action}Pdf):`, err);
      reject(new Error(`Failed to start Python script: ${err.message}. Is Python installed and in PATH?`));
    });
  });
}

/**
 * Helper function to add a watermark to a PDF using a Python script.
 * @param {{filepath: string, originalFilename: string}} file The input PDF file.
 * @returns {Promise<{processedBuffer: Buffer, processedFileName: string, processedMimeType: string, outputFilePath: string}>} The result of the operation.
 */
async function processAddWatermarkWithPython(file) { 
  const uniqueId = uuidv4();
  const outputFileName = `${path.basename(file.originalFilename, path.extname(file.originalFilename))}_watermarked.pdf`;
  const outputFilePath = path.join(os.tmpdir(), outputFileName);

  return new Promise((resolve, reject) => {
    const pythonScriptPath = path.join(process.cwd(), 'scripts', 'add_watermark.py');
    const pythonProcess = spawn('python3', [
      pythonScriptPath,
      file.filepath,
      outputFilePath
    ]);

    let stderrOutput = '';
    pythonProcess.stderr.on('data', (data) => {
      stderrOutput += data.toString();
      console.error(`Python stderr (add_watermark.py): ${data}`);
    });

    pythonProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          const processedBuffer = await fs.readFile(outputFilePath);
          resolve({
            processedBuffer,
            processedFileName: outputFileName,
            processedMimeType: 'application/pdf',
            outputFilePath: outputFilePath 
          });
        } catch (readError) {
          await fs.rm(outputFilePath, { force: true }).catch(console.error);
          reject(new Error(`Failed to read watermarked PDF file: ${readError.message}`));
        }
      } else {
        await fs.rm(outputFilePath, { force: true }).catch(console.error);
        reject(new Error(`Adding watermark failed (Python script exited with code ${code}). Stderr: ${stderrOutput}`));
      }
    });

    pythonProcess.on('error', (err) => {
      console.error('Failed to start Python subprocess (add_watermark.py):', err);
      reject(new Error(`Failed to start Python watermark process: ${err.message}. Is Python installed and in PATH?`));
    });
  });
}

/**
 * Helper function to add page numbers to a PDF using a Python script.
 * @param {string} inputPdfPath The path to the input PDF.
 * @param {string} outputPdfPath The path for the output PDF.
 * @returns {Promise<void>} A promise that resolves when the operation is complete.
 */
async function addPageNumbersToPdf(inputPdfPath, outputPdfPath) {
  return new Promise((resolve, reject) => {
    const pythonScriptPath = path.join(process.cwd(), 'scripts', 'add_page_numbers.py');
    const pythonProcess = spawn('python3', [
      pythonScriptPath,
      inputPdfPath,
      outputPdfPath
    ]);

    let stderrOutput = '';
    pythonProcess.stderr.on('data', (data) => {
      stderrOutput += data.toString();
      console.error(`Python stderr (add_page_numbers): ${data}`);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Adding page numbers failed (Python script exited with code ${code}). Stderr: ${stderrOutput}`));
      }
    });

    pythonProcess.on('error', (err) => {
      console.error('Failed to start Python subprocess (add_page_numbers):', err);
      reject(new Error(`Failed to start Python script for page numbering: ${err.message}. Is Python installed and in PATH?`));
    });
  });
}

/**
 * Helper function to convert DOCX to PDF using a Python script.
 * @param {{filepath: string, originalFilename: string}} file The input DOCX file.
 * @returns {Promise<{processedBuffer: Buffer, processedFileName: string, processedMimeType: string, outputFilePath: string}>} The result of the conversion.
 */
async function processDocxToPdfWithPython(file) {
  const uniqueId = uuidv4();
  const outputDir = path.join(os.tmpdir(), `docx_pdf_py_output_${uniqueId}`);
  await fs.mkdir(outputDir, { recursive: true });

  const outputFileName = `${path.basename(file.originalFilename, path.extname(file.originalFilename))}_converted.pdf`;
  const outputFilePath = path.join(outputDir, outputFileName);

  return new Promise((resolve, reject) => {
    const pythonScriptPath = path.join(process.cwd(), 'scripts', 'convert_docx_to_pdf.py');
    const pythonProcess = spawn('python3', [ 
      pythonScriptPath,
      file.filepath,
      outputFilePath
    ]);

    let stderrOutput = '';
    pythonProcess.stderr.on('data', (data) => {
      stderrOutput += data.toString();
      console.error(`Python stderr (docx2pdf): ${data}`);
    });

    pythonProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          const processedBuffer = await fs.readFile(outputFilePath);
          resolve({
            processedBuffer,
            processedFileName: outputFileName,
            processedMimeType: 'application/pdf',
            outputFilePath: outputFilePath 
          });
        } catch (readError) {
          await fs.rm(outputDir, { recursive: true, force: true }).catch(console.error);
          reject(new Error(`Failed to read converted PDF file: ${readError.message}`));
        }
      } else {
        await fs.rm(outputDir, { recursive: true, force: true }).catch(console.error);
        reject(new Error(`DOCX to PDF conversion failed (Python script exited with code ${code}). Stderr: ${stderrOutput}`));
      }
    });

    pythonProcess.on('error', (err) => {
      console.error('Failed to start Python subprocess (docx2pdf):', err);
      reject(new Error(`Failed to start Python conversion process: ${err.message}. Is Python installed and in PATH?`));
    });
  });
}


/**
 * GET handler to download a processed file or check job status.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const fileName = searchParams.get('fileName');
  const jobId = searchParams.get('jobId');

  // If a jobId is provided, handle as a status check.
  if (jobId) {
    const job = processingJobs.get(jobId);

    if (!job) {
      return new Response(JSON.stringify({ status: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // This is the status check endpoint response
    const responseData = { 
      status: job.status, 
      progress: job.progress ?? null 
    };
    
    // Add download link if job is completed successfully and file still exists
    if (job.status === 'succeeded' && job.fileId) {
      // Check if the file was deleted
      if (job.fileDeleted) {
        responseData.fileStatus = 'deleted';
        if (job.fileDeletedReason === 'auto_cleanup') {
          responseData.message = 'File has been automatically cleaned up after maximum downloads.';
        } else {
          responseData.message = 'File has been manually deleted.';
        }
      } else {
        // Check if the file still exists in the cache
        const fileEntry = processedFilesCache.get(job.fileId);
        if (fileEntry) {
          responseData.downloadLink = `/api/download-processed-file?id=${job.fileId}`;
        } else {
          responseData.fileStatus = 'expired';
          responseData.message = 'File has expired or been automatically cleaned up.';
        }
      }
    }
    
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // If a fileName is not provided, this is a bad request for a download.
  if (!fileName) {
    return new Response(JSON.stringify({ success: false, message: 'File name or Job ID not provided.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Construct the secure file path, preventing directory traversal attacks
  const filePath = path.join(os.tmpdir(), fileName);
  
  // Verify that the file exists and is in the temporary directory
  if (!filePath.startsWith(os.tmpdir())) {
    return new Response(JSON.stringify({ success: false, message: 'Invalid file path.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    const fileContent = await fs.readFile(filePath);
    const mimeType = path.extname(fileName) === '.pdf' ? 'application/pdf' : 'application/zip';

    // Set headers for a file download
    const headers = {
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      ...corsHeaders,
    };

    // This is the final download response
    return new Response(fileContent, { status: 200, headers });

  } catch (error) {
    console.error('Error downloading file:', error);
    return new Response(JSON.stringify({ success: false, message: 'File not found or an error occurred.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
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
 * POST handler to process PDF files based on the requested tool.
 */
export async function POST(request) {
  const jobId = uuidv4(); // Generate a unique job ID for this request

  // First, parse the form data. This is a crucial step.
  const formData = await request.formData();
  const toolId = formData.get('toolId');
  const files = formData.getAll('files');
  const options = JSON.parse(formData.get('options') || '{}');
  const originalPdfFileId = formData.get('originalPdfFileId');
  const originalPdfFileName = formData.get('originalPdfFileName');

  console.log(`Received Request for ${toolId}, filecount: ${files.length}, Job ID: ${jobId}`);

  if (!toolId) {
    return new Response(JSON.stringify({ success: false, message: 'toolId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  // Add the job to the processingJobs map with a 'pending' status.
  addProcessingJob(jobId, toolId, files.map(f => f.name));

  // Immediately return a 202 Accepted response with the jobId.
  // The client can now start polling.
  const responsePayload = {
    success: true,
    isProcessing: true,
    jobId: jobId,
    statusCheckLink: `/api/process-pdf?jobId=${jobId}`,
    message: 'Processing has started. Please poll the status endpoint for updates.'
  };

  // Asynchronously process the files after sending the response.
  (async () => {
    let filesToProcess = [];
    let tempOutputForCurrentTool = null;
    let finalOutputFilePathForCache = null;

    try {
      // Step 1: Save uploaded files locally
      for (const [index, file] of files.entries()) {
        const fileInfo = await saveFileLocally(file);
        filesToProcess.push(fileInfo);
        // Granular progress for file upload
        const progress = Math.floor((index + 1) / files.length * 10);
        updateProcessingJobStatus(jobId, 'active', progress);
      }
      
      updateProcessingJobStatus(jobId, 'active', 10);
      let finalProcessedBuffer;
      let finalOutputMimeType;
      let finalOutputExtension;
      let baseProcessedFileName;

      console.log(`Executing commands for tool: ${toolId}`);

      switch (toolId) {
        case 'appendPageToPdfAndNumber': {
          // This tool expects two files: the main PDF and the single-page PDF to append
          if (filesToProcess.length !== 2) {
            throw new Error('Appending a page requires two PDF files: the original and the page to append.');
          }
          updateProcessingJobStatus(jobId, 'active', 20);
          const existingPdfBuffer = await fs.readFile(filesToProcess[0].filepath);
          const pagePdfBuffer = await fs.readFile(filesToProcess[1].filepath);
          // Step 1: Merge the PDFs
          const mergedPdfBuffer = await appendPageToPdf(existingPdfBuffer, pagePdfBuffer);
          updateProcessingJobStatus(jobId, 'active', 50);
          // Step 2: Save merged PDF to temp file
          const tempMergedPdfPath = path.join(os.tmpdir(), `merged_${jobId}.pdf`);
          await fs.writeFile(tempMergedPdfPath, mergedPdfBuffer);
          // Step 3: Add page numbers
          const numberedPdfPath = path.join(os.tmpdir(), `merged_numbered_${jobId}.pdf`);
          await addPageNumbersToPdf(tempMergedPdfPath, numberedPdfPath);
          updateProcessingJobStatus(jobId, 'active', 80);
          // Step 4: Read final PDF
          finalProcessedBuffer = await fs.readFile(numberedPdfPath);
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = 'pdf_with_appended_page_and_numbers';
          tempOutputForCurrentTool = numberedPdfPath;
          break;
        }
        case 'merge': {
          console.log(`Processing ${toolId} using @pdfme/manipulator (merge)`);
          if (filesToProcess.length < 2) {
            throw new Error('Merging requires at least two PDF files.');
          }
          updateProcessingJobStatus(jobId, 'active', 20);
          
          // Read all PDF files
          const pdfBuffers = await Promise.all(filesToProcess.map(f => fs.readFile(f.filepath)));
          
          // Merge all PDFs using the merge function from @pdfme/manipulator
          finalProcessedBuffer = await merge(pdfBuffers);
          updateProcessingJobStatus(jobId, 'active', 80);
          
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = 'merged_documents';
          break;
        }
        case 'split': {
          console.log(`Processing ${toolId} using @pdfme/manipulator (split)`);
          if (filesToProcess.length !== 1) {
            throw new Error('Splitting requires exactly one PDF file.');
          }
          const pdfBuffer = await fs.readFile(filesToProcess[0].filepath);
          if (pdfBuffer.length === 0) {
              throw new Error("Input PDF file is empty or corrupted.");
          }
          const { pageRange } = options;
          if (!pageRange || typeof pageRange !== 'string' || pageRange.trim() === '') {
              throw new Error('Page range (e.g., "1-7" or "1-3,5,8-10") is required for splitting.');
          }
          const rangesToSplit = [];
          const individualRanges = pageRange.split(',').map(s => s.trim()).filter(s => s.length > 0);
          if (individualRanges.length === 0) {
              throw new Error('Invalid page range format. Please specify at least one page or range.');
          }
          for (const rangeStr of individualRanges) {
              if (rangeStr.includes('-')) {
                  const parts = rangeStr.split('-').map(Number);
                  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
                      throw new Error(`Invalid range format "${rangeStr}". Please use "start-end" (e.g., "1-7").`);
                  }
                  const [start, end] = parts;
                  if (start < 1 || end < start) {
                      throw new Error(`Invalid pages in range "${rangeStr}". Pages must be positive and end page >= start page.`);
                  }
                  rangesToSplit.push({ start: start - 1, end: end - 1 });
              } else {
                  const pageNum = Number(rangeStr);
                  if (isNaN(pageNum) || pageNum < 1) {
                      throw new Error(`Invalid page number "${rangeStr}". Page numbers must be positive integers.`);
                  }
                  // Single page as a 0-indexed, inclusive range
                  rangesToSplit.push({ start: pageNum - 1, end: pageNum - 1 });
              }
          }
          
          updateProcessingJobStatus(jobId, 'active', 20);
          const splitPdfs = await split(pdfBuffer, rangesToSplit);
          if (splitPdfs.length === 0) {
            throw new Error('Splitting resulted in no pages. Check page range and input PDF.');
          }
          
          // If splitting into multiple files, create a zip archive. Otherwise, return single PDF.
          if (splitPdfs.length > 1) {
            const zipBuffer = await new Promise((resolve, reject) => {
              const archive = archiver('zip', { zlib: { level: 9 } });
              const buffers = [];
              archive.on('data', (data) => buffers.push(data));
              archive.on('end', () => resolve(Buffer.concat(buffers)));
              archive.on('error', (err) => reject(err));
              
              splitPdfs.forEach((buffer, index) => {
                const progress = 20 + Math.floor((index + 1) / splitPdfs.length * 60);
                updateProcessingJobStatus(jobId, 'active', progress);
                archive.append(buffer, { name: `split_page_${rangesToSplit[index].start + 1}.pdf` });
              });
              archive.finalize();
            });
            finalProcessedBuffer = zipBuffer;
            finalOutputMimeType = 'application/zip';
            finalOutputExtension = '.zip';
            baseProcessedFileName = 'split_documents';
          } else {
            finalProcessedBuffer = splitPdfs[0];
            finalOutputMimeType = 'application/pdf';
            finalOutputExtension = '.pdf';
            baseProcessedFileName = 'split_document';
          }
          updateProcessingJobStatus(jobId, 'active', 80);
          break;
        }
        case 'rotate': {
          console.log(`Processing ${toolId} using @pdfme/manipulator (rotate)`);
          if (filesToProcess.length !== 1) {
            throw new Error('Rotating requires exactly one PDF file.');
          }
          const { pages, angle } = options;
          if (!pages || !angle) {
            throw new Error('Pages and angle are required for rotation.');
          }
          updateProcessingJobStatus(jobId, 'active', 20);
          const pdfBuffer = await fs.readFile(filesToProcess[0].filepath);
          finalProcessedBuffer = await rotate(pdfBuffer, pages, angle);
          updateProcessingJobStatus(jobId, 'active', 80);
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = 'rotated_document';
          break;
        }
        case 'remove': {
          console.log(`Processing ${toolId} using @pdfme/manipulator (remove)`);
          if (filesToProcess.length !== 1) {
            throw new Error('Removing pages requires exactly one PDF file.');
          }
          const { pages } = options;
          if (!pages) {
            throw new Error('Pages to remove are required.');
          }
          updateProcessingJobStatus(jobId, 'active', 20);
          const pdfBuffer = await fs.readFile(filesToProcess[0].filepath);
          finalProcessedBuffer = await remove(pdfBuffer, pages);
          updateProcessingJobStatus(jobId, 'active', 80);
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = 'document_with_removed_pages';
          break;
        }
        case 'img2pdf': {
          console.log(`Processing ${toolId} using @pdfme/converter`);
          // This is particularly useful for combining scanned PDF pages, which are often just images.
          updateProcessingJobStatus(jobId, 'active', 20);
          const imageBuffers = await Promise.all(filesToProcess.map(f => fs.readFile(f.filepath)));
          finalProcessedBuffer = await img2pdf(imageBuffers);
          updateProcessingJobStatus(jobId, 'active', 80);
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = 'DocSmart';
          break;
        }
        case 'pdf2img': {
          console.log(`Processing ${toolId} using @pdfme/converter`);
          // This tool is useful for extracting pages from a PDF to be used as scanned images.
          if (filesToProcess.length !== 1) {
            throw new Error('PDF to image conversion requires exactly one PDF file.');
          }
          updateProcessingJobStatus(jobId, 'active', 20);
          const pdfBuffer = await fs.readFile(filesToProcess[0].filepath);
          const images = await pdf2img(pdfBuffer);
          
          if (images.length === 0) {
              throw new Error('Conversion to images resulted in no output. The PDF might be empty or corrupted.');
          }
          updateProcessingJobStatus(jobId, 'active', 40);

          const zipBuffer = await new Promise((resolve, reject) => {
            const archive = archiver('zip', { zlib: { level: 9 } });
            const buffers = [];
            archive.on('data', (data) => buffers.push(data));
            archive.on('end', () => resolve(Buffer.concat(buffers)));
            archive.on('error', (err) => reject(err));
            
            images.forEach((imageBuffer, index) => {
              const progress = 40 + Math.floor((index + 1) / images.length * 40);
              updateProcessingJobStatus(jobId, 'active', progress);
              archive.append(imageBuffer, { name: `page_${index + 1}.png` });
            });
            archive.finalize();
          });

          finalProcessedBuffer = zipBuffer;
          finalOutputMimeType = 'application/zip';
          finalOutputExtension = '.zip';
          baseProcessedFileName = 'converted_images';
          updateProcessingJobStatus(jobId, 'active', 80);
          break;
        }
        case 'pdfToWord': {
          console.log(`Processing ${toolId} using Python script`);
          if (filesToProcess.length !== 1) {
            throw new Error('PDF to Word conversion requires exactly one PDF file.');
          }
          updateProcessingJobStatus(jobId, 'active', 20);
          const { processedBuffer, processedFileName, processedMimeType, outputFilePath: pythonOutputFilePath } = await processPdfToWordWithPython(filesToProcess[0]);
          updateProcessingJobStatus(jobId, 'active', 80);
          finalProcessedBuffer = processedBuffer;
          finalOutputMimeType = processedMimeType;
          finalOutputExtension = '.docx';
          baseProcessedFileName = path.basename(processedFileName, finalOutputExtension);
          tempOutputForCurrentTool = pythonOutputFilePath;
          break;
        }
        case 'repairPdf': {
          console.log(`Processing ${toolId} using Python script`);
          if (filesToProcess.length !== 1) {
            throw new Error('PDF repair requires exactly one PDF file.');
          }
          updateProcessingJobStatus(jobId, 'active', 20);
          const { processedBuffer, processedFileName, processedMimeType, outputFilePath: pythonOutputFilePath } = await processRepairPdfWithPython(filesToProcess[0]);
          updateProcessingJobStatus(jobId, 'active', 80);
          finalProcessedBuffer = processedBuffer;
          finalOutputMimeType = processedMimeType;
          finalOutputExtension = '.pdf';
          baseProcessedFileName = path.basename(processedFileName, finalOutputExtension);
          tempOutputForCurrentTool = pythonOutputFilePath;
          break;
        }
        case 'protectPdf': {
          console.log(`Processing ${toolId} using Python script`);
          if (filesToProcess.length !== 1) {
              throw new Error('Protecting a PDF requires exactly one file.');
          }
          const { password } = options;
          if (!password) {
              throw new Error('Password is required to protect the PDF.');
          }
          updateProcessingJobStatus(jobId, 'active', 20);
          const { processedBuffer, processedFileName, processedMimeType, outputFilePath: pythonOutputFilePath } = await processPdfSecurityWithPython('protect', filesToProcess[0], password);
          updateProcessingJobStatus(jobId, 'active', 80);
          finalProcessedBuffer = processedBuffer;
          finalOutputMimeType = processedMimeType;
          finalOutputExtension = '.pdf';
          baseProcessedFileName = path.basename(processedFileName, finalOutputExtension);
          tempOutputForCurrentTool = pythonOutputFilePath;
          break;
        }
        case 'unlockPdf': {
          console.log(`Processing ${toolId} using Python script`);
          if (filesToProcess.length !== 1) {
              throw new Error('Unlocking a PDF requires exactly one file.');
          }
          const { password } = options;
          if (!password) {
              throw new Error('Password is required to unlock the PDF.');
          }
          updateProcessingJobStatus(jobId, 'active', 20);
          const { processedBuffer, processedFileName, processedMimeType, outputFilePath: pythonOutputFilePath } = await processPdfSecurityWithPython('unlock', filesToProcess[0], password);
          updateProcessingJobStatus(jobId, 'active', 80);
          finalProcessedBuffer = processedBuffer;
          finalOutputMimeType = processedMimeType;
          finalOutputExtension = '.pdf';
          baseProcessedFileName = path.basename(processedFileName, finalOutputExtension);
          tempOutputForCurrentTool = pythonOutputFilePath;
          break;
        }
        case 'addWatermark': {
          console.log(`Processing ${toolId} using Python script`);
          if (filesToProcess.length !== 1) {
              throw new Error('Adding a watermark requires exactly one PDF file.');
          }
          updateProcessingJobStatus(jobId, 'active', 20);
          const { processedBuffer, processedFileName, processedMimeType, outputFilePath: pythonOutputFilePath } = await processAddWatermarkWithPython(filesToProcess[0]);
          updateProcessingJobStatus(jobId, 'active', 80);
          finalProcessedBuffer = processedBuffer;
          finalOutputMimeType = processedMimeType;
          finalOutputExtension = '.pdf';
          baseProcessedFileName = path.basename(processedFileName, finalOutputExtension);
          tempOutputForCurrentTool = pythonOutputFilePath;
          break;
        }
        case 'addPageNumbers': {
          console.log(`Processing ${toolId} using Python script`);
          if (filesToProcess.length !== 1) {
            throw new Error('Adding page numbers requires exactly one PDF file.');
          }
          const inputFile = filesToProcess[0];
          const outputFileName = `${path.basename(inputFile.originalFilename, path.extname(inputFile.originalFilename))}_numbered.pdf`;
          const outputFilePath = path.join(os.tmpdir(), outputFileName);
          
          updateProcessingJobStatus(jobId, 'active', 20);
          await addPageNumbersToPdf(inputFile.filepath, outputFilePath);
          updateProcessingJobStatus(jobId, 'active', 80);
          
          finalProcessedBuffer = await fs.readFile(outputFilePath);
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = path.basename(outputFileName, finalOutputExtension);
          tempOutputForCurrentTool = outputFilePath;
          break;
        }
        case 'docxToPdf': {
          console.log(`Processing ${toolId} using Python script`);
          if (filesToProcess.length !== 1) {
            throw new Error('DOCX to PDF conversion requires exactly one DOCX file.');
          }
          updateProcessingJobStatus(jobId, 'active', 20);
          const { processedBuffer, processedFileName, processedMimeType, outputFilePath: pythonOutputFilePath } = await processDocxToPdfWithPython(filesToProcess[0]);
          updateProcessingJobStatus(jobId, 'active', 80);
          finalProcessedBuffer = processedBuffer;
          finalOutputMimeType = processedMimeType;
          finalOutputExtension = '.pdf';
          baseProcessedFileName = path.basename(processedFileName, finalOutputExtension);
          tempOutputForCurrentTool = pythonOutputFilePath;
          break;
        }
        default: {
          throw new Error(`Unsupported toolId: ${toolId}`);
        }
      }

      // Save the final processed buffer to a temporary file
      const finalOutputFileName = `DocSmart_${baseProcessedFileName}_${jobId.substring(0, 8)}${finalOutputExtension}`;
      finalOutputFilePathForCache = path.join(os.tmpdir(), finalOutputFileName);
      await fs.writeFile(finalOutputFilePathForCache, finalProcessedBuffer);
      
      // Add the processed file to the cache for download
      const fileId = uuidv4();
      processedFilesCache.set(fileId, {
        filePath: finalOutputFilePathForCache,
        fileName: finalOutputFileName,
        mimeType: finalOutputMimeType,
        deleteAt: Date.now() + (10 * 60 * 1000), // 10 minutes from now
        accessCount: 0
      });
      
      // Update job status to 'completed' and set the final output file name and file ID
      updateProcessingJobStatus(jobId, 'succeeded', 100, finalOutputFileName, fileId);

    } catch (error) {
      console.error('Error during main workflow:', error);
      // Update job status to 'failed'
      updateProcessingJobStatus(jobId, 'failed', 0);
    } finally {
      // Clean up temporary files
      for (const file of filesToProcess) { 
        try {
          await fs.unlink(file.filepath); 
          console.log(`Cleaned up temporary input file: ${file.filepath}`);
        } catch (cleanupError) {
          console.warn(`Error cleaning up temporary input file ${file.filepath}:`, cleanupError);
        }
      }
      // If the tool created a separate temp output file, clean it up
      if (tempOutputForCurrentTool && tempOutputForCurrentTool !== finalOutputFilePathForCache) {
        try {
          await fs.unlink(tempOutputForCurrentTool); 
          console.log(`Cleaned up temporary tool output file: ${tempOutputForCurrentTool}`);
        } catch (cleanupError) {
          console.warn(`Could not clean up temporary tool output file ${tempOutputForCurrentTool}:`, cleanupError);
        }
      }
    }
  })();
  
  return new Response(JSON.stringify(responsePayload), {
    status: 202, // Using 202 Accepted for asynchronous processing
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
