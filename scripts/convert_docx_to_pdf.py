# scripts/convert_docx_to_pdf.py

import sys
import os
import subprocess

def main():
    if len(sys.argv) != 3:
        print("Usage: python convert_docx_to_pdf.py <input_docx_path> <output_pdf_path>", file=sys.stderr)
        sys.exit(1)
    
    input_docx_path = sys.argv[1]
    output_pdf_path = sys.argv[2]
    convert_docx_to_pdf(input_docx_path, output_pdf_path)

def convert_docx_to_pdf(input_docx_path, output_pdf_path):
    """
    Converts a DOCX file to a PDF using LibreOffice in headless mode.
    """
    if not os.path.exists(input_docx_path):
        print(f"Error: Input DOCX file not found at {input_docx_path}", file=sys.stderr)
        sys.exit(1)

    output_dir = os.path.dirname(output_pdf_path)
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    try:
        print(f"Converting {input_docx_path} to {output_pdf_path} using LibreOffice...")

        # Call LibreOffice to perform conversion
        result = subprocess.run([
            "libreoffice",
            "--headless",
            "--convert-to", "pdf",
            "--outdir", output_dir,
            input_docx_path
        ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

        if result.returncode != 0:
            print(result.stderr.decode(), file=sys.stderr)
            raise RuntimeError("LibreOffice conversion failed.")

        # Construct expected output filename (same base name with .pdf)
        expected_output = os.path.join(output_dir, os.path.splitext(os.path.basename(input_docx_path))[0] + ".pdf")
        if not os.path.exists(expected_output):
            raise FileNotFoundError(f"Expected PDF not found at {expected_output}")

        # Rename to match the exact desired output path
        os.rename(expected_output, output_pdf_path)

        print(f"Successfully converted {input_docx_path} to {output_pdf_path}")
        sys.exit(0)

    except Exception as e:
        print(f"DOCX to PDF conversion failed: {e}", file=sys.stderr)
        print("Ensure LibreOffice is installed and in PATH.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
