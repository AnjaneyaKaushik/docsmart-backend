# DocSmart Backend - Comprehensive Documentation

## 📋 Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [API Endpoints](#api-endpoints)
4. [Features](#features)
5. [Installation & Setup](#installation--setup)
6. [Usage Examples](#usage-examples)
7. [File Management](#file-management)
8. [Error Handling](#error-handling)
9. [Development](#development)

## 🎯 Overview

DocSmart Backend is a robust PDF processing API built with Next.js that provides comprehensive PDF manipulation capabilities. It's designed to handle document processing workflows with job-based tracking, file management, and automated cleanup.

### Key Features
- **Job-based processing** with real-time status tracking
- **Multiple PDF tools** (merge, split, rotate, remove, etc.)
- **Image to PDF conversion** for scanned documents
- **File management** with automatic cleanup
- **CORS support** for cross-origin requests
- **Python script integration** for advanced operations

## 🏗️ Architecture

### Core Components

#### 1. Supabase-backed Job Store and Storage
- Table: processing_jobs (status, progress, file_name, tool_id, public_url, access_count, file_size, optional file_size_mb)
- Storage bucket: processed-pdfs at path public/{jobId}/{fileName}
- Status/polling endpoint reads processing_jobs and returns proxiedDownloadLink and outputFileName
- Access control: proxied downloads increment access_count via an edge function; files expire after 3 accesses or after cleanup window

#### 2. Processing API (Next.js App Router)
- Route: src/app/api/process-pdf/route.js
- Asynchronous job model: returns 202 Accepted with jobId; processing continues server-side
- Tools: merge, split, rotate, remove, img2pdf, pdf2img, pdfToWord, repairPdf, protectPdf, unlockPdf, addWatermark, addPageNumbers, docxToPdf, compress
- Compression: Ghostscript-based with server-inferred targets (no client target needed)
  - Levels: low (higher quality), medium (balanced), extreme (most aggressive)
  - Medium < Low in size; Extreme smallest
- Python helpers: convert PDF↔DOCX, repair PDFs, watermarks, page numbers

#### 3. Proxied Download Flow and Edge Function
- Route: src/app/api/download-proxied-file/route.js
- Calls EDGE_FUNCTION_URL to increment access_count and perform cleanup policies (no sensitive header logging)
- Redirects to the Supabase public_url upon success

#### 4. Cleanup and Retention
- startCleanupService sweeps succeeded/failed jobs older than retention (default ~10 minutes) and deletes their storage objects
- Edge function path enforces per-file access_count limits (max 3 accesses) and can delete on threshold

#### 5. File Size Tracking
- On upload, uploadProcessedFile writes file_size (bytes) to processing_jobs and, if present, file_size_mb (rounded 2 decimals)
- API: GET /api/file-size?fileId=JOB_UUID returns { file_size_mb }

#### 6. Technology Stack
- Next.js 15 (App Router)
- Supabase (Database + Storage) via @supabase/supabase-js

### Error Handling & Fallbacks
- All processing steps are wrapped in a top-level try/catch. On error:
  - processing_jobs.status is set to failed
  - processing_jobs.error_message is updated with a concise error string (best-effort; falls back if the column is missing)
  - progress resets to 0
- Upload errors are caught and logged; job is still marked as succeeded if a local output exists, or failed if not
- Compression uses multiple profiles; if Ghostscript fails to start, an actionable error is stored in error_message
- No sensitive headers or Access tokens are logged in server output

- Ghostscript (system dependency) for PDF compression
- @pdfme/manipulator and @pdfme/converter for PDF ops
- Python (pdf2docx, pikepdf, reportlab) for advanced tasks
- Archiver for ZIP creation; uuid for IDs

## 🔌 API Endpoints

### 1. **Main Processing Endpoint**

#### `POST /api/process-pdf`
Main endpoint for all PDF processing operations.

**Request:**
```javascript
const formData = new FormData();
formData.append('toolId', 'merge');
formData.append('files', file1);
formData.append('files', file2);
formData.append('options', JSON.stringify({}));
```

**Response:**
```json
{
  "success": true,
  "isProcessing": true,
  "jobId": "12345678-1234-1234-1234-123456789012",
  "statusCheckLink": "/api/process-pdf?jobId=12345678-1234-1234-1234-123456789012",
  "message": "Processing has started. Please poll the status endpoint for updates."
}
```

#### `GET /api/process-pdf`
Status checking and file download endpoint.

**Status Check:**
```
GET /api/process-pdf?jobId=12345678-1234-1234-1234-123456789012
```

**Response (Processing):**
```json
{
  "status": "active",
  "progress": 50
}
```

**Response (Completed):**
```json
{
  "status": "succeeded",
  "progress": 100,
  "proxiedDownloadLink": "/api/download-proxied-file?jobId=JOB_UUID",
  "outputFileName": "DocSmart_example_compressed_ab12cd34.pdf"
}
```

**Response (File Deleted):**
```json
{
  "status": "succeeded",
  "progress": 100,
  "fileStatus": "deleted",
  "message": "File has been manually deleted."
}
```

### 2. **File Management Endpoints**

#### `GET /api/download-proxied-file`
Proxied download. Increments access_count via edge function and redirects to Supabase public URL.

```
GET /api/download-proxied-file?jobId=JOB_UUID
```

- No sensitive headers are logged
- Returns 410 when the file has expired or reached max accesses

#### `DELETE /api/delete-processed-file`
Delete processed files.

```
DELETE /api/delete-processed-file?id=file-id
```

**Response:**
```json
{
  "success": true,
  "message": "File 'filename.pdf' deleted successfully."
}
```

#### `GET /api/list-processed-files`
List all processed files including deleted ones.

**Response:**
```json
{
  "success": true,
  "files": [
    {
      "id": "file-id",
      "fileName": "processed_file.pdf",
      "mimeType": "application/pdf",
      "timestamp": 1234567890,
      "accessCount": 1,
      "toolId": "merge",
      "status": "available"
    },
    {
      "id": "deleted-file-id",
      "fileName": "deleted_file.pdf",
      "mimeType": "application/pdf",
      "timestamp": 1234567890,
      "accessCount": 0,
      "toolId": "img2pdf",
      "status": "deleted",
      "deletionReason": "manual"
    }
  ],
  "isProcessing": false
}
```

### 3. **Utility Endpoints**

#### `GET /api/file-size`
Get file size information (in MB).

```
GET /api/file-size?fileId=JOB_UUID
```

**Response:**
```json
{
  "file_size_mb": 10.24
}
```

#### `GET /api/pdf-to-jpg-pages`
Convert PDF pages to JPG images.

```
GET /api/pdf-to-jpg-pages?id=file-id
```

**Response:**
```json
{
  "success": true,
  "pages": [
    "/api/temp-image?path=encoded-path-1",
    "/api/temp-image?path=encoded-path-2"
  ]
}
```

#### `GET /api/temp-image`
Serve temporary images.

```
GET /api/temp-image?path=encoded-file-path
```


### 4. **Tools Overview**

- merge: Merge multiple PDFs into one
- split: Split pages by ranges (ZIP if multiple)
- rotate: Rotate specific pages by angle
- remove: Remove pages
- img2pdf: Convert images to PDF
- pdf2img: Convert PDF pages to images (ZIP)
- pdfToWord: Convert PDF to DOCX (Python)
- docxToPdf: Convert DOCX to PDF (Python)
- protectPdf: Add password (Python)
- unlockPdf: Remove password (Python)
- addWatermark: Add watermark (Python)
- addPageNumbers: Add page numbers (Python)
- compress: Compress PDF with server-inferred target (low, medium, extreme)

## 🛠️ Features

### 1. **PDF Manipulation Tools**

#### **merge**
Combines multiple PDF files into a single PDF.

**Tool ID:** `merge`
**Input:** 2+ PDF files
**Output:** Single merged PDF

```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "toolId=merge" \
  -F "files=@file1.pdf" \
  -F "files=@file2.pdf" \
  -F "files=@file3.pdf" \
  -F "options={}"

#### **compress**
Compress a single PDF. No target size needed; server infers targets based on compressionLevel.

Tool ID: `compress`
Input: 1 PDF file
Options: `{ "compressionLevel": "low|medium|extreme" }` (optional; default: medium)

- low: higher quality, larger file (internally padded by ~5MB to ensure low > medium)
- medium: balanced
- extreme: most aggressive

```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "toolId=compress" \
  -F "files=@/path/to/input.pdf;type=application/pdf" \
  -F 'options={"compressionLevel":"extreme"}'
```

```

#### **img2pdf**
Converts multiple images to a single PDF.

**Tool ID:** `img2pdf`
**Input:** Multiple image files (JPG, PNG, etc.)
**Output:** Single PDF file

```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "toolId=img2pdf" \
  -F "files=@image1.jpg" \
  -F "files=@image2.jpg" \
  -F "options={}"
```

#### **remove**
Removes specific pages from a PDF.

**Tool ID:** `remove`
**Input:** 1 PDF file + page numbers
**Output:** PDF with specified pages removed

```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "toolId=remove" \
  -F "files=@document.pdf" \
  -F "options={\"pages\": [1, 3, 5]}"
```

#### **appendPageToPdfAndNumber**
Appends a single-page PDF to another PDF and adds page numbers.

**Tool ID:** `appendPageToPdfAndNumber`
**Input:** 2 PDF files (main PDF + page to append)
**Output:** PDF with appended page and page numbers

```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "toolId=appendPageToPdfAndNumber" \
  -F "files=@main.pdf" \
  -F "files=@page.pdf" \
  -F "options={}"
```

### 2. **Additional Tools**

#### **split**
Splits a PDF into multiple files based on page ranges.

**Tool ID:** `split`
**Input:** 1 PDF file + page range
**Output:** Multiple PDF files (ZIP if multiple)

```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "toolId=split" \
  -F "files=@document.pdf" \
  -F "options={\"pageRange\": \"1-5,7,9-12\"}"
```

#### **rotate**
Rotates specific pages in a PDF.

**Tool ID:** `rotate`
**Input:** 1 PDF file + pages + angle
**Output:** Rotated PDF

```bash
curl -X POST http://localhost:3000/api/process-pdf \
  -F "toolId=rotate" \
  -F "files=@document.pdf" \
  -F "options={\"pages\": [1, 3], \"angle\": 90}"
```

#### **Python-based Tools**
- **pdfToWord** - Convert PDF to Word document
- **repairPdf** - Repair corrupted PDF files
- **protectPdf** - Add password protection
- **unlockPdf** - Remove password protection
- **addWatermark** - Add watermark to PDF
- **addPageNumbers** - Add page numbers to PDF
- **docxToPdf** - Convert Word document to PDF
- **compress** - Compress PDF (low, medium, extreme). Target size is inferred on the server based on level; no client input required.

## 🚀 Installation & Setup

### Prerequisites
- Node.js 18+
- Python 3.8+
- npm or yarn

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd docsmart-backend
```

2. **Install dependencies**
```bash
npm install
```

3. **Install Python dependencies**
```bash
pip install -r requirements.txt
```

4. **Start development server**
```bash
npm run dev
```

### Environment Configuration

The application uses default configurations for development. For production, consider setting:

```env
NODE_ENV=production
PORT=3000
```

## 📖 Usage Examples

### 1. **Complete Workflow Example**

```javascript
// 1. Upload and process files
const formData = new FormData();
formData.append('toolId', 'merge');
formData.append('files', pdfFile1);
formData.append('files', pdfFile2);

const response = await fetch('/api/process-pdf', {
  method: 'POST',
  body: formData
});

const { jobId, statusCheckLink } = await response.json();

// 2. Poll for status
const checkStatus = async () => {
  const statusResponse = await fetch(statusCheckLink);
  const status = await statusResponse.json();

  if (status.status === 'succeeded' && status.proxiedDownloadLink) {
    // 3. Download the file via the proxied link
    const downloadResponse = await fetch(status.proxiedDownloadLink);
    const blob = await downloadResponse.blob();

    // Save or process the file
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'merged_document.pdf';
    a.click();
  } else if (status.status === 'active') {
    // Continue polling
    setTimeout(checkStatus, 1000);
  }
};

checkStatus();
```

### 2. **Error Handling Example**

```javascript
try {
  const response = await fetch('/api/process-pdf', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
  }

  const result = await response.json();
  // Handle success
} catch (error) {
  console.error('Processing failed:', error.message);
  // Handle error
}
```

### 3. **File Management Example**

```javascript
// List all processed files
const listResponse = await fetch('/api/list-processed-files');
const { files } = await listResponse.json();

// Delete a file
const deleteResponse = await fetch(`/api/delete-processed-file?id=${fileId}`, {
  method: 'DELETE'
});

// Get file size
const sizeResponse = await fetch(`/api/file-size?id=${fileId}`);
const { fileSize } = await sizeResponse.json();
```

## 📁 File Management

### File Lifecycle

1. **Upload** → File saved to temporary directory
2. **Processing** → Job created with unique ID
3. **Completion** → File moved to cache with metadata
4. **Access** → File available for download (up to 3 times)
5. **Cleanup** → File automatically deleted after 10 minutes or 3 downloads

### Cache Management

```javascript
// File cache entry structure
{
  filePath: '/tmp/filename.pdf',
  fileName: 'filename.pdf',
  mimeType: 'application/pdf',
  deleteAt: 1234567890000, // 10 minutes from creation
  accessCount: 1,
  toolId: 'merge'
}
```

### Job Management

```javascript
// Job entry structure
{
  status: 'active' | 'succeeded' | 'failed',
  toolId: 'merge',
  fileNames: ['file1.pdf', 'file2.pdf'],
  progress: 50,
  timestamp: 1234567890000,
  fileId: 'file-uuid',
  outputFileName: 'merged_documents.pdf'
}
```

## ⚠️ Error Handling

### Common Error Responses

#### **400 Bad Request**
```json
{
  "success": false,
  "message": "toolId is required"
}
```

#### **404 Not Found**
```json
{
  "status": "not found"
}
```

#### **500 Internal Server Error**
```json
{
  "success": false,
  "message": "Server error: Error details"
}
```

### Error Types

1. **Validation Errors** - Missing required fields, invalid file types
2. **Processing Errors** - PDF manipulation failures, Python script errors
3. **File Errors** - File not found, permission issues
4. **System Errors** - Memory issues, disk space problems

## 🔧 Development

### Project Structure

```
docsmart-backend/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── process-pdf/
│   │   │   ├── download-processed-file/
│   │   │   ├── delete-processed-file/
│   │   │   ├── list-processed-files/
│   │   │   ├── file-size/
│   │   │   ├── pdf-to-jpg-pages/
│   │   │   └── temp-image/
│   │   ├── layout.js
│   │   └── page.js
│   └── lib/
│       └── fileCache.js
├── scripts/
│   ├── convert_pdf_to_docx.py
│   ├── repair_pdf_pikepdf.py
│   ├── protect_pdf.py
│   ├── add_watermark.py
│   └── add_page_numbers.py
├── package.json
└── requirements.txt
```

### Adding New Tools

1. **Add tool case in `process-pdf/route.js`**
```javascript
case 'newTool': {
  // Tool implementation
  break;
}
```

2. **Add Python script if needed**
```python
# scripts/new_tool.py
def process_file(input_path, output_path):
    # Implementation
    pass
```

3. **Update documentation**

### Testing

```bash
# Run development server
npm run dev

# Test endpoints
curl -X POST http://localhost:3000/api/process-pdf \
  -F "toolId=merge" \
  -F "files=@test.pdf" \
  -F "options={}"
```

### Deployment

1. **Build the application**
```bash
npm run build
```

2. **Start production server**
```bash
npm start
```

3. **Environment considerations**
- Set appropriate CORS origins
- Configure file storage limits
- Set up monitoring and logging
- Configure backup strategies

## 📝 License

This project is licensed under the MIT License.

---

**DocSmart Backend** - A comprehensive PDF processing API for document automation workflows.
