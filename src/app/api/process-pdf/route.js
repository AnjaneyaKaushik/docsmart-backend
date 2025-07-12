// src/app/api/process-pdf/route.js

import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import archiver from 'archiver';
import { exec, spawn } from 'child_process';
import os from 'os';

import { processedFilesCache, startCleanupService } from '@/lib/fileCache'; 

import { img2pdf, pdf2img } from '@pdfme/converter';
import { merge, split, rotate } from '@pdfme/manipulator';

// REMOVED: import { sign } from 'pdf-signer';

startCleanupService();

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// --- CORS Headers Definition ---
// This allows requests from any origin during development/testing.
// For production, you might want to specify your exact frontend origin.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Allows all origins
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', // Methods allowed
  'Access-Control-Allow-Headers': 'Content-Type, Authorization', // Headers allowed
};
// --- End CORS Headers Definition ---


async function saveFileLocally(file) {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);      

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const extension = path.extname(file.name);
  const baseName = path.basename(file.name, extension);
  const filename = `${baseName}-${uniqueSuffix}${extension}`;
  const filepath = path.join(os.tmpdir(), filename);

  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, buffer);
  return { filepath, originalFilename: file.name, mimetype: file.type, name: file.name, arrayBuffer: bytes };
}

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
          await fs.rm(outputDir, { recursive: true, force: true }).catch(console.error);
          resolve({
            processedBuffer,
            processedFileName: outputFileName,
            processedMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          });
        } catch (readError) {
          await fs.rm(outputDir, { recursive: true, force: true }).catch(console.error);
          reject(new Error(`Failed to read converted Word file or clean up: ${readError.message}`));
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

// --- Add an OPTIONS handler for preflight requests ---
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: corsHeaders,
  });
}

export async function POST(request) {
  const locallyUploadedInputFiles = [];

  try {
    const formData = await request.formData();

    const fields = {};
    const filesToProcess = [];

    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') {
        fields[key] = value;
      } else if (value instanceof Blob) {
        const savedFile = await saveFileLocally(value);
        locallyUploadedInputFiles.push(savedFile.filepath);
        filesToProcess.push(savedFile);
      }
    }

    if (filesToProcess.length === 0) {
      return new Response(JSON.stringify({ success: false, message: 'No files uploaded.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }, // <--- Add CORS headers here
      });
    }

    const toolId = fields.toolId;
    if (!toolId) {
      throw new Error('Tool ID not provided.');
    }

    console.log(`Received request for tool: ${toolId}, files count: ${filesToProcess.length}`);

    let finalProcessedBuffer = null;
    let finalOutputMimeType = '';
    let finalOutputExtension = '';
    let baseProcessedFileName = '';
    let originalInputFileName = filesToProcess[0]?.originalFilename || 'processed_file';


    switch (toolId) {
      case 'merge':
        if (filesToProcess.length < 2) {
          throw new Error('Merge PDF requires at least two files.');
        }
        console.log("Processing merge using @pdfme/manipulator...");
        const pdfsToMerge = filesToProcess.map(f => f.arrayBuffer);
        const mergedPdf = await merge(pdfsToMerge);
        finalProcessedBuffer = Buffer.from(mergedPdf);
        finalOutputMimeType = 'application/pdf';
        finalOutputExtension = '.pdf';
        baseProcessedFileName = `${path.basename(originalInputFileName, path.extname(originalInputFileName))}_merged`;
        break;

      case 'split':
        if (filesToProcess.length !== 1) {
          throw new Error('Split PDF requires exactly one file.');
        }
        const pdfToSplit = filesToProcess[0].arrayBuffer;
        const ranges = fields.ranges;

        if (!ranges) {
            throw new Error('Split tool requires page ranges (e.g., "1-3,5").');
        }

        const splitRanges = ranges.split(',').map(range => {
            const parts = range.split('-').map(Number);
            if (parts.length === 1) {
                return { start: parts[0] - 1, end: parts[0] - 1 };
            } else if (parts.length === 2) {
                return { start: parts[0] - 1, end: parts[1] - 1 };
            }
            throw new Error(`Invalid range format: "${range}" for split.`);
        });

        const splitPdfs = await split(pdfToSplit, splitRanges);

        if (splitPdfs.length > 1) {
            const archive = archiver('zip', { zlib: { level: 9 } });
            finalProcessedBuffer = await new Promise((resolve, reject) => {
                const buffers = [];
                archive.on('data', chunk => buffers.push(chunk));
                archive.on('end', () => resolve(Buffer.concat(buffers)));
                archive.on('error', reject);

                splitPdfs.forEach((pdfBuffer, index) => {
                    archive.append(Buffer.from(pdfBuffer), { name: `split_part_${index + 1}.pdf` });
                });
                archive.finalize();
            });
            finalOutputMimeType = 'application/zip';
            finalOutputExtension = '.zip';
            baseProcessedFileName = `${path.basename(originalInputFileName, path.extname(originalInputFileName))}_split_parts`;
        } else if (splitPdfs.length === 1) {
            finalProcessedBuffer = Buffer.from(splitPdfs[0]);
            finalOutputMimeType = 'application/pdf';
            finalOutputExtension = '.pdf';
            baseProcessedFileName = `${path.basename(originalInputFileName, path.extname(originalInputFileName))}_split`;
        } else {
            throw new Error('Split tool produced no output PDFs.');
        }
        break;

      case 'compress':
        if (filesToProcess.length !== 1) {
          throw new Error('Compress PDF requires exactly one file.');
        }
        if (filesToProcess[0].mimetype !== 'application/pdf') {
          throw new Error('Only PDF files are supported for compression.');
        }
        console.log("Processing compress using npx compress-pdf CLI...");
        const inputPdfPath = filesToProcess[0].filepath;

        const compressOutputUniqueDir = path.join(os.tmpdir(), 'compressed_output', uuidv4());
        const compressOutputFileName = `${path.basename(filesToProcess[0].originalFilename, path.extname(filesToProcess[0].originalFilename))}_compressed.pdf`;
        const compressOutputFilePath = path.join(compressOutputUniqueDir, compressOutputFileName);

        try {
            await fs.mkdir(compressOutputUniqueDir, { recursive: true });
            console.log(`Ensured output directory exists for compress: ${compressOutputUniqueDir}`);
        } catch (dirError) {
            console.error(`Error creating output directory ${compressOutputUniqueDir}:`, dirError);
            return new Response(JSON.stringify({ success: false, message: `Failed to create output directory: ${dirError.message}` }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }); // <--- Add CORS headers here
        }

        try {
          const command = `npx compress-pdf --file "${inputPdfPath}" --output "${compressOutputFilePath}"`;
          console.log(`Executing command: ${command}`);

          await new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
              if (error) {
                console.error(`exec error: ${error}`);
                if (stderr.includes('gs: command not found') || stderr.includes('Ghostscript')) {
                    return reject(new Error('Ghostscript is not installed or not in PATH. compress-pdf requires Ghostscript.'));
                }
                return reject(new Error(`CLI command failed: ${error.message}\nStderr: ${stderr}`));
              }
              if (stderr) {
                console.warn(`CLI stderr: ${stderr}`);
              }
              console.log(`CLI stdout: ${stdout}`);
              resolve();
            });
          });
          console.log(`PDF compressed from ${inputPdfPath} to ${compressOutputFilePath} via CLI.`);
        } catch (cliError) {
          console.error('Error during CLI compress-pdf execution:', cliError);
          throw new Error(`PDF compression failed: ${cliError.message}`);
        }

        finalProcessedBuffer = await fs.readFile(compressOutputFilePath);
        finalOutputMimeType = 'application/pdf';
        finalOutputExtension = '.pdf';
        baseProcessedFileName = path.basename(compressOutputFileName, finalOutputExtension); 

        try {
            await fs.rm(compressOutputUniqueDir, { recursive: true, force: true });
            console.log(`Cleaned up temporary compressed output directory: ${compressOutputUniqueDir}`);
        } catch (cleanupDirError) {
            console.warn(`Could not clean up temporary compressed output directory ${compressOutputUniqueDir}:`, cleanupDirError);
        }
        break;

      case 'pdfToWord':
          if (filesToProcess.length !== 1) {
              throw new Error('PDF to Word conversion requires exactly one PDF file.');
          }
          if (filesToProcess[0].mimetype !== 'application/pdf') {
              throw new Error('Only PDF files are supported for PDF to Word conversion.');
          }
          console.log("Processing PDF to Word using Python script (pdf2docx)...");
          const pythonWordResult = await processPdfToWordWithPython(filesToProcess[0]);
          finalProcessedBuffer = pythonWordResult.processedBuffer;
          finalOutputMimeType = pythonWordResult.processedMimeType;
          finalOutputExtension = path.extname(pythonWordResult.processedFileName);
          baseProcessedFileName = path.basename(pythonWordResult.processedFileName, finalOutputExtension);
          break;

      case 'wordToPdf':
          return new Response(JSON.stringify({
            success: false,
            message: `${toolId} conversion is not currently supported by this backend version.`,
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }, // <--- Add CORS headers here
          });

      case 'jpgToPdf':
          if (filesToProcess.length === 0) {
              throw new Error('JPG to PDF requires at least one image file.');
          }
          if (!filesToProcess.every(f => f.mimetype.startsWith('image/'))) {
              throw new Error('JPG to PDF tool only accepts image files.');
          }
          console.log("Processing JPG to PDF using @pdfme/converter...");
          const imagesToConvert = filesToProcess.map(f => f.arrayBuffer);
          const imgPdf = await img2pdf(imagesToConvert);
          finalProcessedBuffer = Buffer.from(imgPdf);
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = `${path.basename(originalInputFileName, path.extname(originalInputFileName))}_converted`;
          break;

      case 'pdfToJpg':
          if (filesToProcess.length !== 1) {
              throw new Error('PDF to JPG requires exactly one PDF file.');
          }
          if (filesToProcess[0].mimetype !== 'application/pdf') {
              throw new Error('Only PDF files are supported for PDF to JPG conversion.');
          }
          console.log("Processing PDF to JPG using @pdfme/converter...");
          const pdfToImg = filesToProcess[0].arrayBuffer;
          const images = await pdf2img(pdfToImg, {
              imageType: 'jpeg',
              scale: 1,
          });

          if (images.length === 0) {
              throw new Error('PDF to JPG conversion resulted in no images.');
          }

          if (images.length > 1) {
              const archive = archiver('zip', { zlib: { level: 9 } });
              finalProcessedBuffer = await new Promise((resolve, reject) => {
                  const buffers = [];
                  archive.on('data', chunk => buffers.push(chunk));
                  archive.on('end', () => resolve(Buffer.concat(buffers)));
                  archive.on('error', reject);
                  images.forEach((imgBuffer, index) => {
                      archive.append(Buffer.from(imgBuffer), { name: `page_${index + 1}.jpg` });
                  });
                  archive.finalize();
              });
              finalOutputMimeType = 'application/zip';
              finalOutputExtension = '.zip';
              baseProcessedFileName = `${path.basename(originalInputFileName, path.extname(originalInputFileName))}_images`;
          } else {
              finalProcessedBuffer = Buffer.from(images[0]);
              finalOutputMimeType = 'image/jpeg';
              finalOutputExtension = '.jpg';
              baseProcessedFileName = `${path.basename(originalInputFileName, path.extname(originalInputFileName))}_page_1`;
          }
          break;

      case 'rotatePdf':
          if (filesToProcess.length !== 1) {
            throw new Error('Rotate PDF requires exactly one file.');
          }
          if (filesToProcess[0].mimetype !== 'application/pdf') {
              throw new Error('Only PDF files are supported for Rotate PDF conversion.');
          }
          console.log("Processing rotate using @pdfme/manipulator...");
          const pdfToRotate = filesToProcess[0].arrayBuffer;
          const rotateDegrees = parseInt(fields.rotate_value || '0', 10);
          if (![0, 90, 180, 270, 360].includes(rotateDegrees)) {
            throw new Error('Rotation degrees must be 0, 90, 180, 270, or 360.');
          }
          const rotatedPdf = await rotate(pdfToRotate, rotateDegrees);
          finalProcessedBuffer = Buffer.from(rotatedPdf);
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = `${path.basename(originalInputFileName, path.extname(originalInputFileName))}_rotated`;
          break;

      // REMOVED: case 'signPdf': block was here

      default:
        throw new Error(`Unsupported tool: ${toolId}`);
    }

    if (!finalProcessedBuffer) {
        throw new Error('Processing failed: No output buffer generated.');
    }

    const suggestedFileName = `${baseProcessedFileName}${finalOutputExtension}`;

    const uniqueFileId = uuidv4();
    const localDownloadDir = path.join(os.tmpdir(), 'processed_downloads');
    await fs.mkdir(localDownloadDir, { recursive: true });
    const localFilePath = path.join(localDownloadDir, uniqueFileId + finalOutputExtension);

    try {
        await fs.writeFile(localFilePath, finalProcessedBuffer);
    } catch (writeError) {
        console.error(`Error writing file to disk: ${writeError}`);
        throw new Error(`Failed to save processed file locally: ${writeError.message}`);
    }

    const fileCacheEntry = {
      filePath: localFilePath,
      fileName: suggestedFileName,
      mimeType: finalOutputMimeType,
      timestamp: Date.now(),
      deleteAt: Date.now() + (10 * 60 * 1000),
    };
    processedFilesCache.set(uniqueFileId, fileCacheEntry);

    return new Response(JSON.stringify({
      success: true,
      downloadUrl: `/api/download-processed-file?id=${uniqueFileId}`,
      originalFileName: originalInputFileName,
      processedFileName: suggestedFileName,
      mimeType: finalOutputMimeType,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }, // <--- Add CORS headers here
    });

  } catch (error) {
    console.error('Error during main workflow:', error);
    return new Response(JSON.stringify({ success: false, message: `Server error: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }, // <--- Add CORS headers here
    });
  } finally {
    for (const filePath of locallyUploadedInputFiles) {
      try {
        await fs.unlink(filePath);
        console.log(`Cleaned up temporary input file: ${filePath}`);
      } catch (cleanupError) {
        console.error(`Error cleaning up temporary input file ${filePath}:`, cleanupError);
      }
    }
  }
}