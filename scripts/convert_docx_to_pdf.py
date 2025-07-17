# scripts/convert_docx_to_pdf.py

import sys
import os
from docx2pdf import convert # 

def main():
    if len(sys.argv) != 3:
        print("Usage: python convert_docx_to_pdf.py <input_docx_path> <output_pdf_path>", file=sys.stderr)
        sys.exit(1)
    
    input_docx_path = sys.argv[1]
    output_pdf_path = sys.argv[2]
    convert_docx_to_pdf(input_docx_path, output_pdf_path)

def convert_docx_to_pdf(input_docx_path, output_pdf_path):
    """
    Converts a DOCX file to a PDF file using the docx2pdf Python library.
    This requires LibreOffice to be installed on Linux.
    """
    if not os.path.exists(input_docx_path):
        print(f"Error: Input DOCX file not found at {input_docx_path}", file=sys.stderr)
        sys.exit(1)

    output_dir = os.path.dirname(output_pdf_path)
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    try:
        print(f"Converting {input_docx_path} to {output_pdf_path} using docx2pdf...")
        
        # Perform the conversion
        convert(input_docx_path, output_pdf_path) # 
        
        if not os.path.exists(output_pdf_path):
            raise FileNotFoundError(f"docx2pdf did not produce the expected output file: {output_pdf_path}")
        
        print(f"Successfully converted {input_docx_path} to {output_pdf_path}")
        sys.exit(0) # Indicate success

    except Exception as e:
        print(f"DOCX to PDF conversion failed with docx2pdf: {e}", file=sys.stderr)
        print("Ensure LibreOffice is installed and accessible in the system's PATH.", file=sys.stderr)
        sys.exit(1) # Indicate failure

if __name__ == "__main__":
    main()