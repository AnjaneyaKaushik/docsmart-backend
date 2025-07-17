import os
import sys
import uuid
import shutil
import subprocess

def convert_docx_to_pdf(input_path, output_dir):
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")

    if not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    # Run LibreOffice to convert DOCX to PDF
    try:
        subprocess.run(
            ['libreoffice', '--headless', '--convert-to', 'pdf', '--outdir', output_dir, input_path],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"DOCX to PDF conversion failed: {e.stderr.decode().strip()}")

    # Determine the output PDF path
    input_filename = os.path.basename(input_path)
    base_filename, _ = os.path.splitext(input_filename)
    output_pdf_path = os.path.join(output_dir, base_filename + '.pdf')

    if not os.path.exists(output_pdf_path):
        raise FileNotFoundError("DOCX to PDF conversion failed: Output file not found.")

    return output_pdf_path

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python convert_docx_to_pdf.py <input_path> <output_dir>")
        sys.exit(1)

    input_path = sys.argv[1]
    output_dir = sys.argv[2]

    try:
        result_path = convert_docx_to_pdf(input_path, output_dir)
        print(f"Converted PDF: {result_path}")
    except Exception as e:
        print(f"DOCX to PDF conversion failed: {e}")
        sys.exit(1)
