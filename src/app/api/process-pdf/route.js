// src/app/api/process-pdf/route.js

import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import archiver from 'archiver';
import { exec, spawn } from 'child_process'; // Keep exec and spawn for other tools
import os from 'os';

// Removed node-qpdf2 imports as we are moving to Python for security features
// import { encrypt, decrypt } from 'node-qpdf2'; 

import { processedFilesCache, startCleanupService } from '@/lib/fileCache'; 

import { img2pdf, pdf2img } from '@pdfme/converter';
import { merge, split, rotate } from '@pdfme/manipulator'; 

startCleanupService();

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// --- CORS Headers Definition ---
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
// --- End CORS Headers Definition ---


async function saveFileLocally(file) {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);      

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const extension = path.extname(file.name);
  const baseName = path.basename(file.name, extension);
  const filename = `${baseName}-${uniqueSuffix}${extension}`;
  const filepath = path.join(os.tmpdir(), filename); // Use os.tmpdir() for temporary files

  await fs.writeFile(filepath, buffer);
  console.log(`[saveFileLocally] File saved to: ${filepath}`); // Added log
  return {
    filepath,
    originalFilename: file.name,
    mimetype: file.type,
  };
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

// New helper function for PDF protection/unlocking using Python
async function processPdfSecurityWithPython(action, file, password) {
  const uniqueId = uuidv4();
  const outputFileName = `${action}_${uuidv4()}.pdf`;
  const outputFilePath = path.join(os.tmpdir(), outputFileName);

  return new Promise((resolve, reject) => {
    const pythonScriptPath = path.join(process.cwd(), 'scripts', 'protect_pdf.py');
    const pythonProcess = spawn('python3', [
      pythonScriptPath,
      action, // 'protect' or 'unlock'
      file.filepath,
      outputFilePath,
      password || '' // Pass empty string if no password provided for unlock
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
          await fs.rm(outputFilePath, { force: true }).catch(console.error); // Clean up on read error
          reject(new Error(`Failed to read processed PDF file: ${readError.message}`));
        }
      } else {
        await fs.rm(outputFilePath, { force: true }).catch(console.error); // Clean up on process error
        reject(new Error(`PDF ${action} failed (Python script exited with code ${code}). Stderr: ${stderrOutput}`));
      }
    });

    pythonProcess.on('error', (err) => {
      console.error(`Failed to start Python subprocess (${action}Pdf):`, err);
      reject(new Error(`Failed to start Python script: ${err.message}. Is Python installed and in PATH?`));
    });
  });
}


export async function OPTIONS(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(request) {
  let filesToProcess = [];
  let finalOutputFilePathForCache; 

  try {
    const formData = await request.formData();
    const toolId = formData.get('toolId');
    const files = formData.getAll('files');
    const options = JSON.parse(formData.get('options') || '{}');

    console.log(`Received Request for ${toolId}, filecount: ${files.length}`);

    if (!toolId) {
      throw new Error('toolId is required');
    }
    if (!files || files.length === 0) {
      throw new Error('No files uploaded');
    }

    for (const file of files) {
      filesToProcess.push(await saveFileLocally(file));
    }

    let finalProcessedBuffer;
    let finalOutputMimeType;
    let finalOutputExtension;
    let baseProcessedFileName;
    let tempOutputForCurrentTool; 

    console.log(`Executing commands for tool: ${toolId}`);

    switch (toolId) {
      case 'merge': {
        console.log(`Processing ${toolId} using @pdfme/manipulator (merge)`);
        if (filesToProcess.length < 2) {
          throw new Error('Merging requires at least two PDF files.');
        }
        const pdfBuffers = await Promise.all(filesToProcess.map(f => fs.readFile(f.filepath)));
        finalProcessedBuffer = await merge(pdfBuffers);
        finalOutputMimeType = 'application/pdf';
        finalOutputExtension = '.pdf';
        baseProcessedFileName = 'merged_document';
        break;
      }
      case 'split': {
        console.log(`Processing ${toolId} using @pdfme/manipulator (split)`);
        if (filesToProcess.length !== 1) {
          throw new Error('Splitting requires exactly one PDF file.');
        }
        const pdfBuffer = await fs.readFile(filesToProcess[0].filepath);
        const { pageRange } = options; // Expecting a string like "1-7"

        if (!pageRange || typeof pageRange !== 'string') {
            throw new Error('Page range (e.g., "1-7") is required for splitting.');
        }

        const pageParts = pageRange.split('-').map(Number);
        if (pageParts.length !== 2 || isNaN(pageParts[0]) || isNaN(pageParts[1])) {
            throw new Error('Invalid page range format. Please use "start-end" (e.g., "1-7").');
        }

        const [startPage, endPage] = pageParts;

        if (startPage < 1 || endPage < startPage) { // Pages are 1-indexed for user input
            throw new Error('Invalid start or end page for splitting. Pages must be positive and end page >= start page.');
        }

        // @pdfme/manipulator split function is 0-indexed for the second argument (end page is exclusive)
        // So, if user wants 1-7, we pass [1, 8]
        const splitPdfs = await split(pdfBuffer, [startPage, endPage + 1]); 
        
        if (splitPdfs.length === 0) {
            throw new Error('Splitting resulted in no pages. Check page range.');
        }

        if (splitPdfs.length === 1) {
            finalProcessedBuffer = splitPdfs[0];
            finalOutputMimeType = 'application/pdf';
            finalOutputExtension = '.pdf';
            baseProcessedFileName = `${path.basename(filesToProcess[0].originalFilename, '.pdf')}_split_p${startPage}-p${endPage}`;
        } else {
            const archive = archiver('zip', { zlib: { level: 9 } });
            const zipBuffer = await new Promise((resolve, reject) => {
                const buffers = [];
                archive.on('data', (data) => buffers.push(data));
                archive.on('end', () => resolve(Buffer.concat(buffers)));
                archive.on('error', (err) => reject(err));

                splitPdfs.forEach((pdfBuffer, index) => {
                    archive.append(pdfBuffer, { name: `page_${startPage + index}.pdf` });
                });
                archive.finalize();
            });
            finalProcessedBuffer = zipBuffer;
            finalOutputMimeType = 'application/zip';
            finalOutputExtension = '.zip';
            baseProcessedFileName = `${path.basename(filesToProcess[0].originalFilename, '.pdf')}_split_parts`;
        }
        break;
      }
      case 'compress': {
        console.log(`Processing ${toolId} using npx compress-pdf (Ghostscript)`);
        if (filesToProcess.length !== 1) {
          throw new Error('Compression requires exactly one PDF file.');
        }
        const inputPath = filesToProcess[0].filepath;
        tempOutputForCurrentTool = path.join(os.tmpdir(), `compressed_${uuidv4()}.pdf`);

        const {
            resolution = 'ebook', // Default to 'ebook' if not provided
            compatibilityLevel,
            pdfPassword,
            removePasswordAfterCompression,
            gsModule = '/usr/bin/gs' // Default to where we installed gs
        } = options;

        let compressCommand = `npx compress-pdf --file "${inputPath}" --output "${tempOutputForCurrentTool}"`;

        if (resolution) {
            compressCommand += ` --resolution "${resolution}"`;
        }
        if (compatibilityLevel !== undefined) {
            compressCommand += ` --compatibilityLevel ${compatibilityLevel}`;
        }
        if (gsModule) {
            compressCommand += ` --gsModule "${gsModule}"`;
        }
        if (pdfPassword) {
            compressCommand += ` --pdfPassword "${pdfPassword}"`;
        }
        if (removePasswordAfterCompression !== undefined) {
            compressCommand += ` --removePasswordAfterCompression ${removePasswordAfterCompression}`;
        }

        console.log(`Executing compress-pdf command: ${compressCommand}`);
        console.log(`Command being executed: ${compressCommand}`);

        await new Promise((resolve, reject) => {
            exec(compressCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error(`compress-pdf error: ${error.message}`);
                    console.error(`compress-pdf stderr: ${stderr}`);
                    return reject(new Error(`PDF compression failed: ${error.message}`));
                }
                if (stderr) console.warn(`compress-pdf warning: ${stderr}`);
                resolve();
            });
        });
        finalProcessedBuffer = await fs.readFile(tempOutputForCurrentTool);
        finalOutputMimeType = 'application/pdf';
        finalOutputExtension = '.pdf';
        baseProcessedFileName = `${path.basename(filesToProcess[0].originalFilename, '.pdf')}_compressed`;
        break;
      }
      case 'protectPdf': {
        console.log(`Processing ${toolId} using Python script (pikepdf)`);
        if (filesToProcess.length !== 1) {
            throw new Error('Protect PDF requires exactly one PDF file.');
        }
        const { password } = options;
        if (!password) {
            throw new Error('Password is required to protect the PDF.');
        }
        
        const pythonResult = await processPdfSecurityWithPython('protect', filesToProcess[0], password);
        finalProcessedBuffer = pythonResult.processedBuffer;
        finalOutputMimeType = pythonResult.processedMimeType;
        finalOutputExtension = path.extname(pythonResult.processedFileName);
        baseProcessedFileName = path.basename(filesToProcess[0].originalFilename, '.pdf') + '_protected';
        tempOutputForCurrentTool = pythonResult.outputFilePath; 
        break;
      }
      case 'unlockPdf': {
        console.log(`Processing ${toolId} using Python script (pikepdf)`);
        if (filesToProcess.length !== 1) {
            throw new Error('Unlock PDF requires exactly one PDF file.');
        }
        const { password } = options;
        
        const pythonResult = await processPdfSecurityWithPython('unlock', filesToProcess[0], password);
        finalProcessedBuffer = pythonResult.processedBuffer;
        finalOutputMimeType = pythonResult.processedMimeType;
        finalOutputExtension = path.extname(pythonResult.processedFileName);
        baseProcessedFileName = path.basename(filesToProcess[0].originalFilename, '.pdf') + '_unlocked';
        tempOutputForCurrentTool = pythonResult.outputFilePath; 
        break;
      }
      case 'pdfToWord':
          console.log(`Processing ${toolId} using Python script (pdf2docx)`);
          if (filesToProcess.length !== 1) {
              throw new Error('PDF to Word conversion requires exactly one PDF file.');
          }
          if (filesToProcess[0].mimetype !== 'application/pdf') {
              throw new Error('Only PDF files are supported for PDF to Word conversion.');
          }
          console.log("Processing PDF to Word using Python script...");
          const pythonWordResult = await processPdfToWordWithPython(filesToProcess[0]);
          finalProcessedBuffer = pythonWordResult.processedBuffer;
          finalOutputMimeType = pythonWordResult.processedMimeType;
          finalOutputExtension = path.extname(pythonWordResult.processedFileName);
          baseProcessedFileName = path.basename(pythonWordResult.processedFileName, finalOutputExtension);
          tempOutputForCurrentTool = pythonWordResult.outputFilePath; 
          break;
      case 'jpgToPdf': {
          console.log(`Processing ${toolId} using @pdfme/converter (img2pdf)`);
          if (filesToProcess.length === 0) {
              throw new Error('JPG to PDF conversion requires at least one image file.');
          }
          const imageMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
          const allImages = filesToProcess.every(file => imageMimeTypes.includes(file.mimetype));
          if (!allImages) {
              throw new Error('Only image files (JPG, PNG, GIF, WEBP) are supported for JPG to PDF conversion.');
          }

          const imageBuffers = await Promise.all(filesToProcess.map(f => fs.readFile(f.filepath)));
          // Convert Buffer to Uint8Array for img2pdf
          const imageUint8Arrays = imageBuffers.map(buffer => new Uint8Array(buffer));
          finalProcessedBuffer = await img2pdf(imageUint8Arrays); // Pass Uint8Array
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = 'images_converted';
          break;
      }
      case 'pdfToJpg': {
          console.log(`Processing ${toolId} using @pdfme/converter (pdf2img)`);
          if (filesToProcess.length !== 1) {
              throw new Error('PDF to JPG conversion requires exactly one PDF file.');
          }
          if (filesToProcess[0].mimetype !== 'application/pdf') {
              throw new Error('Only PDF files are supported for PDF to JPG conversion.');
          }

          const pdfBuffer = await fs.readFile(filesToProcess[0].filepath);
          // Convert Buffer to Uint8Array for pdf2img
          const pdfUint8Array = new Uint8Array(pdfBuffer);
          const images = await pdf2img(pdfUint8Array); // Pass Uint8Array
          
          if (images.length === 0) {
              throw new Error('Could not extract images from PDF.');
          }

          const archive = archiver('zip', { zlib: { level: 9 } });
          const zipBuffer = await new Promise((resolve, reject) => {
              const buffers = [];
              archive.on('data', (data) => buffers.push(data));
              archive.on('end', () => resolve(Buffer.concat(buffers)));
              archive.on('error', (err) => reject(err));

              // Convert Uint8Array to Buffer before appending to archiver
              images.forEach((imgUint8Array, index) => {
                  archive.append(Buffer.from(imgUint8Array), { name: `page_${index + 1}.jpg` }); 
              });
              archive.finalize();
          });

          finalProcessedBuffer = zipBuffer;
          finalOutputMimeType = 'application/zip';
          finalOutputExtension = '.zip';
          baseProcessedFileName = `${path.basename(filesToProcess[0].originalFilename, '.pdf')}_images`;
          break;
      }
      case 'rotatePdf': {
          console.log(`Processing ${toolId} using @pdfme/manipulator (rotate)`);
          if (filesToProcess.length !== 1) {
              throw new Error('Rotate PDF requires exactly one PDF file.');
          }
          if (filesToProcess[0].mimetype !== 'application/pdf') {
              throw new Error('Only PDF files are supported for PDF rotation.');
          }
          const { angle } = options; 
          if (![90, 180, 270].includes(angle)) {
              throw new Error('Invalid rotation angle. Must be 90, 180, or 270.');
          }

          const pdfBuffer = await fs.readFile(filesToProcess[0].filepath);
          finalProcessedBuffer = await rotate(pdfBuffer, angle);
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = `${path.basename(filesToProcess[0].originalFilename, '.pdf')}_rotated`;
          break;
      }
      case 'repairPdf': {
        console.log(`Processing ${toolId} using Python script (pikepdf)`);
        if (filesToProcess.length !== 1) {
            throw new Error('Repair PDF requires exactly one PDF file.');
        }
        if (filesToProcess[0].mimetype !== 'application/pdf') {
            throw new Error('Only PDF files are supported for PDF repair.');
        }
        console.log("Processing PDF repair using Python script (pikepdf)...");
        const pythonRepairResult = await processRepairPdfWithPython(filesToProcess[0]);
        finalProcessedBuffer = pythonRepairResult.processedBuffer;
        finalOutputMimeType = pythonRepairResult.processedMimeType;
        finalOutputExtension = path.extname(pythonRepairResult.processedFileName);
        baseProcessedFileName = path.basename(pythonRepairResult.processedFileName, finalOutputExtension);
        tempOutputForCurrentTool = pythonRepairResult.outputFilePath; 
        break;
      }
      case 'docxToPdf': 
          console.log(`Processing ${toolId} using Python script (docx2pdf)`);
          if (filesToProcess.length !== 1) {
              throw new Error('DOCX to PDF conversion requires exactly one DOCX file.');
          }
          const docxMimeTypes = [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 
            'application/msword' 
          ];
          if (!docxMimeTypes.includes(filesToProcess[0].mimetype)) {
              throw new Error('Only DOCX/DOC files are supported for DOCX to PDF conversion.');
          }
          console.log("Processing DOCX to PDF using Python script (docx2pdf)...");
          const pythonPdfResult = await processDocxToPdfWithPython(filesToProcess[0]);
          finalProcessedBuffer = pythonPdfResult.processedBuffer;
          finalOutputMimeType = pythonPdfResult.processedMimeType;
          finalOutputExtension = path.extname(pythonPdfResult.processedFileName);
          baseProcessedFileName = path.basename(pythonPdfResult.processedFileName, finalOutputExtension);
          tempOutputForCurrentTool = pythonPdfResult.outputFilePath; 
          break;
      case 'addPageNumbers': {
        console.log(`Processing ${toolId} using Python script (custom)`);
        if (filesToProcess.length !== 1) {
            throw new Error('Adding page numbers requires exactly one PDF file.');
        }
        if (filesToProcess[0].mimetype !== 'application/pdf') {
            throw new Error('Only PDF files are supported for adding page numbers.');
        }

        const inputPdfPath = filesToProcess[0].filepath;
        const outputFileName = `${path.basename(filesToProcess[0].originalFilename, '.pdf')}_numbered.pdf`;
        const outputFilePath = path.join(os.tmpdir(), outputFileName);

        try {
            await new Promise((resolve, reject) => {
                const pythonScriptPath = path.join(process.cwd(), 'scripts', 'add_page_numbers.py');
                const pythonProcess = spawn('python3', [
                    pythonScriptPath,
                    inputPdfPath,
                    outputFilePath
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
                    reject(new Error(`Failed to start Python script: ${err.message}. Is Python installed and in PATH?`));
                });
            });

            finalProcessedBuffer = await fs.readFile(outputFilePath);
            finalOutputMimeType = 'application/pdf';
            finalOutputExtension = '.pdf';
            baseProcessedFileName = path.basename(outputFileName, finalOutputExtension);
            tempOutputForCurrentTool = outputFilePath;

        } catch (error) {
            console.error('Error in addPageNumbers:', error);
            if (outputFilePath && await fs.access(outputFilePath).then(() => true).catch(() => false)) {
                await fs.unlink(outputFilePath).catch(e => console.error("Error cleaning up failed page number file:", e));
            }
            throw error;
        }
        break;
      }

      default:
        throw new Error(`Unsupported tool: ${toolId}`);
    }

    const finalOutputFileName = `DocSmart_${baseProcessedFileName || 'processed_file'}${finalOutputExtension}`;
    finalOutputFilePathForCache = path.join(os.tmpdir(), `${uuidv4()}_${finalOutputFileName}`); 

    if (tempOutputForCurrentTool) {
      await fs.rename(tempOutputForCurrentTool, finalOutputFilePathForCache);
    } else {
      await fs.writeFile(finalOutputFilePathForCache, finalProcessedBuffer);
    }

    const uniqueFileId = uuidv4();
    const cacheEntry = {
      filePath: finalOutputFilePathForCache, 
      fileName: finalOutputFileName,         
      mimeType: finalOutputMimeType,         
      accessCount: 0,
      toolId: toolId, // Store the toolId
      timestamp: Date.now() // Store the current timestamp
    };
    processedFilesCache.set(uniqueFileId, cacheEntry);
    console.log(`File cached: ${finalOutputFileName}, ID: ${uniqueFileId}, Access Count: ${cacheEntry.accessCount}`); // Log access count

    return new Response(JSON.stringify({
      success: true,
      process: true,
      downloadUrl: `/api/download-processed-file?id=${uniqueFileId}`,
      originalFileName: filesToProcess.length === 1 ? filesToProcess[0].originalFilename : null,
      processedFileName: finalOutputFileName,
      mimeType: finalOutputMimeType,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });

  } catch (error) {
    console.error('Error during main workflow:', error);
    return new Response(JSON.stringify({ success: false, message: `Server error: ${error.message}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } finally {
    for (const file of filesToProcess) { 
      try {
        await fs.unlink(file.filepath); 
        console.log(`Cleaned up temporary input file: ${file.filepath}`);
      } catch (cleanupError) {
        console.error(`Error cleaning up temporary input file ${file.filepath}:`, cleanupError);
      }
    }
    // No specific qpdfOutputTempDir cleanup needed as Python script handles its own temp files
  }
}
