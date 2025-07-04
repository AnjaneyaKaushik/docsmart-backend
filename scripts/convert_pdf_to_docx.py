# scripts/convert_pdf_to_docx.py

import sys
import os
from pdf2docx import Converter

def main():
    if len(sys.argv) != 3:
        print("Usage: python convert_pdf_to_docx.py <input_pdf_path> <output_docx_path>", file=sys.stderr)
        sys.exit(1)
    
    input_pdf_path = sys.argv[1]
    output_docx_path = sys.argv[2]
    convert_pdf_to_docx(input_pdf_path, output_docx_path)

def convert_pdf_to_docx(input_pdf_path, output_docx_path):
    """
    Converts a PDF file to a DOCX file using the pdf2docx Python library.
    """
    if not os.path.exists(input_pdf_path):
        print(f"Error: Input PDF file not found at {input_pdf_path}", file=sys.stderr)
        sys.exit(1)

    output_dir = os.path.dirname(output_docx_path)
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    try:
        print(f"Converting {input_pdf_path} to {output_docx_path} using pdf2docx...")
        
        # Initialize the converter
        cv = Converter(input_pdf_path)
        
        # Convert and save the DOCX file
        cv.convert(output_docx_path, start=0, end=None) # Convert all pages
        
        # Close the converter
        cv.close()

        if not os.path.exists(output_docx_path):
            raise FileNotFoundError(f"pdf2docx did not produce the expected output file: {output_docx_path}")
        
        print(f"Successfully converted {input_pdf_path} to {output_docx_path}")
        sys.exit(0) # Indicate success

    except Exception as e:
        print(f"pdf2docx conversion failed: {e}", file=sys.stderr)
        sys.exit(1) # Indicate failure

if __name__ == "__main__":
    main()