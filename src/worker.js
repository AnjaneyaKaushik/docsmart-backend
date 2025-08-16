// src/worker.js

import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import archiver from 'archiver';
import { spawn } from 'child_process';
import os from 'os';

import { getPendingJobAndLock, updateProcessingJobStatus, uploadProcessedFile, getSupabaseClient, deleteFileFromStorage } from './lib/supabaseService.js';

import { img2pdf, pdf2img } from '@pdfme/converter';
import { merge, split, rotate, remove } from '@pdfme/manipulator';

// --- Worker Configuration ---
const WORKER_ID = `worker-${uuidv4()}`;
const POLL_INTERVAL = 5000; // 5 seconds
const supabase = getSupabaseClient();
// --- End Worker Configuration ---

async function downloadFileFromSupabase(storagePath) {
  const { data, error } = await supabase.storage
    .from('raw-inputs')
    .download(storagePath);

  if (error) {
    throw new Error(`Failed to download file from storage: ${storagePath}. Reason: ${error.message}`);
  }

  const localFileName = path.basename(storagePath);
  const localFilePath = path.join(os.tmpdir(), `worker_${WORKER_ID}_${localFileName}`);

  const buffer = Buffer.from(await data.arrayBuffer());
  await fs.writeFile(localFilePath, buffer);

  return localFilePath;
}


async function appendPageToPdf(existingPdfBuffer, pagePdfBuffer) {
  // Uses the merge function from @pdfme/manipulator
  return await merge([existingPdfBuffer, pagePdfBuffer]);
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

async function executePdfProcessing(job) {
  const { id: jobId, tool_id: toolId, input_file_paths: inputFilePaths, options } = job;

  let filesToProcess = [];
  try {
    // Download input files
    for (const storagePath of inputFilePaths) {
        const filepath = await downloadFileFromSupabase(storagePath);
        const originalFilename = path.basename(storagePath);
        filesToProcess.push({ filepath, originalFilename, storagePath }); // Store storagePath as well
    }

    await updateProcessingJobStatus(jobId, 'in_progress', 10);

    let finalProcessedBuffer;
    let finalOutputMimeType;
    let finalOutputExtension;
    let baseProcessedFileName;

    // --- Start of PDF Processing Logic ---
    // This is the large switch statement moved from the original route.js
    switch (toolId) {
        case 'appendPageToPdfAndNumber': {
          // This tool expects two files: the main PDF and the single-page PDF to append
          if (filesToProcess.length !== 2) {
            throw new Error('Appending a page requires two PDF files: the original and the page to append.');
          }
          await updateProcessingJobStatus(jobId, 'in_progress', 20);
          const existingPdfBuffer = await fs.readFile(filesToProcess[0].filepath);
          const pagePdfBuffer = await fs.readFile(filesToProcess[1].filepath);
          // Step 1: Merge the PDFs
          const mergedPdfBuffer = await appendPageToPdf(existingPdfBuffer, pagePdfBuffer);
          await updateProcessingJobStatus(jobId, 'in_progress', 50);
          // Step 2: Save merged PDF to temp file
          const tempMergedPdfPath = path.join(os.tmpdir(), `merged_${jobId}.pdf`);
          await fs.writeFile(tempMergedPdfPath, mergedPdfBuffer);
          // Step 3: Add page numbers
          const numberedPdfPath = path.join(os.tmpdir(), `merged_numbered_${jobId}.pdf`);
          await addPageNumbersToPdf(tempMergedPdfPath, numberedPdfPath);
          await updateProcessingJobStatus(jobId, 'in_progress', 80);
          // Step 4: Read final PDF
          finalProcessedBuffer = await fs.readFile(numberedPdfPath);
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = 'pdf_with_appended_page_and_numbers';
          break;
        }
        case 'merge': {
          console.log(`Processing ${toolId} using @pdfme/manipulator (merge)`);
          if (filesToProcess.length < 2) {
            throw new Error('Merging requires at least two PDF files.');
          }
          await updateProcessingJobStatus(jobId, 'in_progress', 20);

          // Read all PDF files
          const pdfBuffers = await Promise.all(filesToProcess.map(f => fs.readFile(f.filepath)));

          // Merge all PDFs using the merge function from @pdfme/manipulator
          finalProcessedBuffer = await merge(pdfBuffers);
          await updateProcessingJobStatus(jobId, 'in_progress', 80);

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

          await updateProcessingJobStatus(jobId, 'in_progress', 20);
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
                updateProcessingJobStatus(jobId, 'in_progress', progress);
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
          await updateProcessingJobStatus(jobId, 'in_progress', 80);
          break;
        }
      case 'compress': {
          console.log(`Processing ${toolId} using Ghostscript (compress)`);
          if (filesToProcess.length !== 1) {
            throw new Error('Compressing requires exactly one PDF file.');
          }
          await updateProcessingJobStatus(jobId, 'in_progress', 20);

          const inputFilePath = filesToProcess[0].filepath;
          const { compressionLevel = 'medium', grayscale = false } = options || {};

          console.log(`[COMPRESSION DEBUG] Received compression level: ${compressionLevel}`);

          // Helper to run Ghostscript with a given profile
          const runGsWithProfile = async (preset, tweak, attemptIdx) => {
            const attemptOut = attemptIdx > 0
              ? path.join(os.tmpdir(), `compressed_${jobId}_${attemptIdx}.pdf`)
              : path.join(os.tmpdir(), `compressed_${jobId}.pdf`);

            const gsArgs = [
              '-sDEVICE=pdfwrite',
              '-dCompatibilityLevel=1.4',
              `-dPDFSETTINGS=/${preset}`,
              '-dNOPAUSE',
              '-dQUIET',
              '-dBATCH',
              `-sOutputFile=${attemptOut}`,
              inputFilePath,
            ];

            if (tweak) {
              const { jpegQ, colorDpi, grayDpi, monoDpi } = tweak;
              gsArgs.push(
                '-dAutoFilterColorImages=false',
                '-dAutoFilterGrayImages=false',
                '-sColorImageFilter=/DCTEncode',
                '-sGrayImageFilter=/DCTEncode',
                '-dEncodeColorImages=true',
                '-dEncodeGrayImages=true',
                '-dEncodeMonoImages=true',
                '-sMonoImageFilter=/CCITTFaxEncode',
                `-dJPEGQ=${jpegQ}`,
                '-dDownsampleColorImages=true',
                '-dColorImageDownsampleType=/Bicubic',
                `-dColorImageResolution=${colorDpi}`,
                '-dColorImageDownsampleThreshold=1.0',
                '-dDownsampleGrayImages=true',
                '-dGrayImageDownsampleType=/Bicubic',
                `-dGrayImageResolution=${grayDpi}`,
                '-dGrayImageDownsampleThreshold=1.0',
                '-dDownsampleMonoImages=true',
                '-dMonoImageDownsampleType=/Subsample',
                `-dMonoImageResolution=${monoDpi}`,
                '-dMonoImageDownsampleThreshold=1.0',
                '-dDetectDuplicateImages=true',
                '-dCompressFonts=true',
                '-dSubsetFonts=true',
                '-dFastWebView=true'
              );
            }
            
            if (grayscale === true) {
                gsArgs.push('-sProcessColorModel=DeviceGray', '-sColorConversionStrategy=Gray', '-dOverrideICC');
            }

            await new Promise((resolve, reject) => {
              const gsProc = spawn('gs', gsArgs);
              let stderrOutput = '';
              gsProc.stderr.on('data', (data) => { stderrOutput += data.toString(); });
              gsProc.on('close', (code) => {
                if (code === 0) return resolve();
                reject(new Error(`Ghostscript exited with code ${code}. Stderr: ${stderrOutput}`));
              });
              gsProc.on('error', (err) => { reject(new Error(`Failed to start Ghostscript (gs). ${err.message}`)); });
            });

            return attemptOut;
          };

          let outputFilePath;
          let profile;

          if (compressionLevel === 'extreme') {
            profile = { preset: 'screen', tweak: { jpegQ: 25, colorDpi: 36,  grayDpi: 36,  monoDpi: 100 } };
          } else if (compressionLevel === 'medium') {
            profile = { preset: 'ebook',   tweak: { jpegQ: 70, colorDpi: 120, grayDpi: 120, monoDpi: 300 } };
          } else { // low
            profile = { preset: 'printer', tweak: { jpegQ: 100, colorDpi: 300, grayDpi: 300, monoDpi: 300 } };
          }

          outputFilePath = await runGsWithProfile(profile.preset, profile.tweak, 0);
          await updateProcessingJobStatus(jobId, 'in_progress', 80);

          // Read compressed file and set final outputs
          finalProcessedBuffer = await fs.readFile(outputFilePath);
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          const origBaseName = path.basename(filesToProcess[0].originalFilename, path.extname(filesToProcess[0].originalFilename));
          baseProcessedFileName = `${origBaseName}_compressed`;
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
          await updateProcessingJobStatus(jobId, 'in_progress', 20);
          const pdfBuffer = await fs.readFile(filesToProcess[0].filepath);
          finalProcessedBuffer = await rotate(pdfBuffer, pages, angle);
          await updateProcessingJobStatus(jobId, 'in_progress', 80);
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
          await updateProcessingJobStatus(jobId, 'in_progress', 20);
          const pdfBuffer = await fs.readFile(filesToProcess[0].filepath);
          finalProcessedBuffer = await remove(pdfBuffer, pages);
          await updateProcessingJobStatus(jobId, 'in_progress', 80);
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = 'document_with_removed_pages';
          break;
        }
        case 'img2pdf': {
          console.log(`Processing ${toolId} using @pdfme/converter`);
          // This is particularly useful for combining scanned PDF pages, which are often just images.
          await updateProcessingJobStatus(jobId, 'in_progress', 20);
          const imageBuffers = await Promise.all(filesToProcess.map(f => fs.readFile(f.filepath)));
          finalProcessedBuffer = await img2pdf(imageBuffers);
          await updateProcessingJobStatus(jobId, 'in_progress', 80);
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
          await updateProcessingJobStatus(jobId, 'in_progress', 20);
          const pdfBuffer = await fs.readFile(filesToProcess[0].filepath);
          const images = await pdf2img(pdfBuffer);

          if (images.length === 0) {
              throw new Error('Conversion to images resulted in no output. The PDF might be empty or corrupted.');
          }
          updateProcessingJobStatus(jobId, 'in_progress', 40);

          const zipBuffer = await new Promise((resolve, reject) => {
            const archive = archiver('zip', { zlib: { level: 9 } });
            const buffers = [];
            archive.on('data', (data) => buffers.push(data));
            archive.on('end', () => resolve(Buffer.concat(buffers)));
            archive.on('error', (err) => reject(err));

            images.forEach((imageBuffer, index) => {
              const progress = 40 + Math.floor((index + 1) / images.length * 40);
              updateProcessingJobStatus(jobId, 'in_progress', progress);
              archive.append(imageBuffer, { name: `page_${index + 1}.png` });
            });
            archive.finalize();
          });

          finalProcessedBuffer = zipBuffer;
          finalOutputMimeType = 'application/zip';
          finalOutputExtension = '.zip';
          baseProcessedFileName = 'converted_images';
          await updateProcessingJobStatus(jobId, 'in_progress', 80);
          break;
        }
        case 'pdfToWord': {
          console.log(`Processing ${toolId} using Python script`);
          if (filesToProcess.length !== 1) {
            throw new Error('PDF to Word conversion requires exactly one PDF file.');
          }
          await updateProcessingJobStatus(jobId, 'in_progress', 20);
          const { processedBuffer, processedFileName, processedMimeType, outputFilePath: pythonOutputFilePath } = await processPdfToWordWithPython(filesToProcess[0]);
          await updateProcessingJobStatus(jobId, 'in_progress', 80);
          finalProcessedBuffer = processedBuffer;
          finalOutputMimeType = processedMimeType;
          finalOutputExtension = '.docx';
          baseProcessedFileName = path.basename(processedFileName, finalOutputExtension);
          break;
        }
        case 'repairPdf': {
          console.log(`Processing ${toolId} using Python script`);
          if (filesToProcess.length !== 1) {
            throw new Error('PDF repair requires exactly one PDF file.');
          }
          await updateProcessingJobStatus(jobId, 'in_progress', 20);
          const { processedBuffer, processedFileName, processedMimeType, outputFilePath: pythonOutputFilePath } = await processRepairPdfWithPython(filesToProcess[0]);
          await updateProcessingJobStatus(jobId, 'in_progress', 80);
          finalProcessedBuffer = processedBuffer;
          finalOutputMimeType = processedMimeType;
          finalOutputExtension = '.pdf';
          baseProcessedFileName = path.basename(processedFileName, finalOutputExtension);
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
          await updateProcessingJobStatus(jobId, 'in_progress', 20);
          const { processedBuffer, processedFileName, processedMimeType, outputFilePath: pythonOutputFilePath } = await processPdfSecurityWithPython('protect', filesToProcess[0], password);
          await updateProcessingJobStatus(jobId, 'in_progress', 80);
          finalProcessedBuffer = processedBuffer;
          finalOutputMimeType = processedMimeType;
          finalOutputExtension = '.pdf';
          baseProcessedFileName = path.basename(processedFileName, finalOutputExtension);
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
          updateProcessingJobStatus(jobId, 'in_progress', 20);
          const { processedBuffer, processedFileName, processedMimeType, outputFilePath: pythonOutputFilePath } = await processPdfSecurityWithPython('unlock', filesToProcess[0], password);
          updateProcessingJobStatus(jobId, 'in_progress', 80);
          finalProcessedBuffer = processedBuffer;
          finalOutputMimeType = processedMimeType;
          finalOutputExtension = '.pdf';
          baseProcessedFileName = path.basename(processedFileName, finalOutputExtension);
          break;
        }
        case 'addWatermark': {
          console.log(`Processing ${toolId} using Python script`);
          if (filesToProcess.length !== 1) {
              throw new Error('Adding a watermark requires exactly one PDF file.');
          }
          updateProcessingJobStatus(jobId, 'in_progress', 20);
          const { processedBuffer, processedFileName, processedMimeType, outputFilePath: pythonOutputFilePath } = await processAddWatermarkWithPython(filesToProcess[0]);
          updateProcessingJobStatus(jobId, 'in_progress', 80);
          finalProcessedBuffer = processedBuffer;
          finalOutputMimeType = processedMimeType;
          finalOutputExtension = '.pdf';
          baseProcessedFileName = path.basename(processedFileName, finalOutputExtension);
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

          updateProcessingJobStatus(jobId, 'in_progress', 20);
          await addPageNumbersToPdf(inputFile.filepath, outputFilePath);
          updateProcessingJobStatus(jobId, 'in_progress', 80);

          finalProcessedBuffer = await fs.readFile(outputFilePath);
          finalOutputMimeType = 'application/pdf';
          finalOutputExtension = '.pdf';
          baseProcessedFileName = path.basename(outputFileName, finalOutputExtension);
          break;
        }
        case 'docxToPdf': {
          console.log(`Processing ${toolId} using Python script`);
          if (filesToProcess.length !== 1) {
            throw new Error('DOCX to PDF conversion requires exactly one DOCX file.');
          }
          updateProcessingJobStatus(jobId, 'in_progress', 20);
          const { processedBuffer, processedFileName, processedMimeType, outputFilePath: pythonOutputFilePath } = await processDocxToPdfWithPython(filesToProcess[0]);
          updateProcessingJobStatus(jobId, 'in_progress', 80);
          finalProcessedBuffer = processedBuffer;
          finalOutputMimeType = processedMimeType;
          finalOutputExtension = '.pdf';
          baseProcessedFileName = path.basename(processedFileName, finalOutputExtension);
          break;
        }
        default: {
          throw new Error(`Unsupported toolId: ${toolId}`);
        }
      }
    // --- End of PDF Processing Logic ---

    const finalOutputFileName = `DocSmart_${baseProcessedFileName}_${jobId.substring(0, 8)}${finalOutputExtension}`;

    // Upload result to Supabase
    const { publicUrl, error: uploadError } = await uploadProcessedFile(jobId, finalProcessedBuffer, finalOutputFileName, finalOutputMimeType);

    if (uploadError) {
        throw new Error(`Failed to upload processed file. Reason: ${uploadError.message}`);
    }

    // Mark job as succeeded
    await updateProcessingJobStatus(jobId, 'succeeded', 100, finalOutputFileName, publicUrl);
    console.log(`Job ${jobId} completed successfully.`);

  } catch (error) {
    console.error(`Error processing job ${jobId}:`, error);
    await updateProcessingJobStatus(jobId, 'failed', 0, null, null, error.message);
  } finally {
    // Cleanup local temporary files
    for (const file of filesToProcess) {
      try {
        await fs.unlink(file.filepath);
        console.log(`Deleted local temporary file: ${file.filepath}`);
      } catch (cleanupError) {
        console.warn(`Error cleaning up local temporary file ${file.filepath}:`, cleanupError);
      }
      // Also delete from Supabase raw-inputs bucket
      if (file.storagePath) {
        try {
          await deleteFileFromStorage('raw-inputs', file.storagePath);
          console.log(`Deleted input file from Supabase storage: ${file.storagePath}`);
        } catch (supabaseCleanupError) {
          console.warn(`Error cleaning up Supabase raw input file ${file.storagePath}:`, supabaseCleanupError);
        }
      }
    }
  }
}

async function workerLoop() {
  console.log(`Worker ${WORKER_ID} started. Polling for jobs...`);

  while (true) {
    const { job, error } = await getPendingJobAndLock(WORKER_ID);

    if (error) {
      console.error('Error polling for jobs:', error.message);
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
      continue;
    }

    if (job && job.id) {
      console.log(`Picked up job: ${job.id}`);
      await executePdfProcessing(job);
    } else if (job) {
        // got a job, but it is null
        // so we wait for the next poll
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    } else {
      // No job found, wait for the next poll
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }
  }
}

// Start the worker
workerLoop().catch(err => {
  console.error('Worker loop crashed:', err);
  process.exit(1);
});