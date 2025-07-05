// src/app/api/process-pdf/route.js

import fs from 'fs/promises'; // For reading/writing temporary files
import path from 'path';
import { v4 as uuidv4 } from 'uuid'; // For generating unique IDs
import archiver from 'archiver'; // For zipping multiple files
import { exec, spawn } from 'child_process'; // For executing shell commands and Python scripts
import os from 'os'; // For os.tmpdir() to create temporary directories

// Import the shared cache and cleanup service from src/lib/fileCache.js
import { processedFilesCache, startCleanupService } from '@/lib/fileCache'; 

// Import @pdfme libraries:
import { img2pdf, pdf2img } from '@pdfme/converter'; // Re-importing @pdfme/converter
import { merge, split, rotate } from '@pdfme/manipulator';

// Import PDFDocument from pdf-lib (still useful for general PDF operations like compression)

// Ensure cleanup service is started (important for serverless functions)
startCleanupService();

// IMPORTANT: Configuration for App Router API routes.
export const dynamic = 'force-dynamic'; // Ensures the route is not cached
export const runtime = 'nodejs'; // Essential for using Node.js APIs like 'fs'

// --- Helper function to save file from FormDataEntryValue (File) ---
async function saveFileLocally(file) {
  const bytes = await file.arrayBuffer(); // Read file content as ArrayBuffer
  const buffer = Buffer.from(bytes);      // Convert to Node.js Buffer

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const extension = path.extname(file.name);
  const baseName = path.basename(file.name, extension);
  const filename = `${baseName}-${uniqueSuffix}${extension}`; // Create unique temp filename
  const filepath = path.join(process.cwd(), 'tmp', filename); // Path in /tmp directory

  // Ensure 'tmp' directory exists (critical for Vercel's /tmp)
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, buffer); // Write file to disk
  return { filepath, originalFilename: file.name, mimetype: file.type, name: file.name, arrayBuffer: bytes };
}

// --- Helper function to process PDF to Word using Python script (pdf2docx) ---
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
          await fs.rm(outputDir, { recursive: true, force: true }).catch(console.error); // Clean up output directory
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

// Removed processPdfToJpgWithPython helper function
// Removed processJpgToPdfWithPython helper function


// Main API Route Handler for App Router
export async function POST(request) {
  const locallyUploadedInputFiles = []; // To store temp input files for cleanup

  try {
    const formData = await request.formData();

    const fields = {};
    const filesToProcess = [];

    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') {
        fields[key] = value;
      } else if (value instanceof Blob) {
        const savedFile = await saveFileLocally(value);
        locallyUploadedInputFiles.push(savedFile.filepath); // Add temp path for cleanup
        filesToProcess.push(savedFile);
      }
    }

    if (filesToProcess.length === 0) {
      return new Response(JSON.stringify({ success: false, message: 'No files uploaded.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
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


    // Define tool categories for routing logic
    const pdfmeManipulatorTools = ['merge', 'split', 'rotatePdf'];
    const pdfmeConverterTools = ['jpgToPdf', 'pdfToJpg']; // Re-added for @pdfme/converter
    const cliCompressTool = ['compress']; // 'compress' uses CLI
    const pythonWordTool = ['pdfToWord']; // pdfToWord uses Python script

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

      case 'compress': // Using CLI compress-pdf
        if (filesToProcess.length !== 1) {
          throw new Error('Compress PDF requires exactly one file.');
        }
        if (filesToProcess[0].mimetype !== 'application/pdf') {
          throw new Error('Only PDF files are supported for compression.');
        }
        console.log("Processing compress using npx compress-pdf CLI...");
        const inputPdfPath = filesToProcess[0].filepath; // Path to the uploaded file
        const outputPdfDir = path.join(process.cwd(), 'tmp', 'compressed_output', uuidv4()); // Unique output dir
        await fs.mkdir(outputPdfDir, { recursive: true });
        const outputPdfPath = path.join(outputPdfDir, `${path.basename(filesToProcess[0].originalFilename, path.extname(filesToProcess[0].originalFilename))}_compressed.pdf`);

        try {
          const command = `npx compress-pdf --file "${inputPdfPath}" --output "${outputPdfPath}"`;
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
          console.log(`PDF compressed from ${inputPdfPath} to ${outputPdfPath} via CLI.`);
        } catch (cliError) {
          console.error('Error during CLI compress-pdf execution:', cliError);
          throw new Error(`PDF compression failed: ${cliError.message}`);
        }

        finalProcessedBuffer = await fs.readFile(outputPdfPath);
        finalOutputMimeType = 'application/pdf';
        finalOutputExtension = '.pdf';
        baseProcessedFileName = path.basename(outputPdfPath, finalOutputExtension); 

        await fs.unlink(outputPdfPath).catch(err => console.error(`Error cleaning up temp compressed file ${outputPdfPath}:`, err));
        await fs.rm(outputPdfDir, { recursive: true, force: true }).catch(err => console.error(`Error cleaning up temp compressed directory ${outputPdfDir}:`, err));
        break;

      case 'pdfToWord': // Using Python script (pdf2docx)
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

      case 'wordToPdf': // Not supported by current local libraries
          return new Response(JSON.stringify({
            success: false,
            message: `${toolId} conversion is not currently supported by this backend version.`,
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });

      case 'jpgToPdf': // Using @pdfme/converter
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

      case 'pdfToJpg': // Using @pdfme/converter
          if (filesToProcess.length !== 1) {
              throw new Error('PDF to JPG requires exactly one PDF file.');
          }
          if (filesToProcess[0].mimetype !== 'application/pdf') {
              throw new Error('Only PDF files are supported for PDF to JPG conversion.');
          }
          console.log("Processing PDF to JPG using @pdfme/converter...");
          const pdfToImg = filesToProcess[0].arrayBuffer;
          const images = await pdf2img(pdfToImg, {
              imageType: 'jpeg', // Specify JPG output
              scale: 1, // 1:1 scale, adjust for higher/lower resolution
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

      case 'rotatePdf': // Using @pdfme/manipulator
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

      default:
        throw new Error(`Unsupported tool: ${toolId}`);
    }

    if (!finalProcessedBuffer) {
        throw new Error('Processing failed: No output buffer generated.');
    }

    const suggestedFileName = `${baseProcessedFileName}${finalOutputExtension}`;

    const uniqueFileId = uuidv4();
    const localDownloadDir = path.join(process.cwd(), 'tmp', 'processed_downloads');
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
      deleteAt: Date.now() + (10 * 60 * 1000), // 10 minutes for cleanup
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
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error during main workflow:', error);
    return new Response(JSON.stringify({ success: false, message: `Server error: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
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
