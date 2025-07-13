# scripts/extract_text_from_pdf.py

import sys
import os
import PyPDF2 # Changed from pdfplumber to PyPDF2

def main():
    if len(sys.argv) != 3:
        print("Usage: python extract_text_from_pdf.py <input_pdf_path> <output_txt_path>", file=sys.stderr)
        sys.exit(1)

    input_pdf_path = sys.argv[1]
    output_txt_path = sys.argv[2]
    extract_text_from_pdf(input_pdf_path, output_txt_path)

def extract_text_from_pdf(input_pdf_path, output_txt_path):
    """
    Extracts text from a PDF file and saves it to a TXT file using PyPDF2.
    """
    if not os.path.exists(input_pdf_path):
        print(f"Error: Input PDF file not found at {input_pdf_path}", file=sys.stderr)
        sys.exit(1)

    output_dir = os.path.dirname(output_txt_path)
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    try:
        print(f"Extracting text from {input_pdf_path} to {output_txt_path} using PyPDF2...")
        full_text = ""
        with open(input_pdf_path, 'rb') as file:
            reader = PyPDF2.PdfReader(file) # Use PdfReader for PyPDF2 v3.0.0+
            for page_num in range(len(reader.pages)):
                page = reader.pages[page_num]
                full_text += page.extract_text() + "\n" # Add a newline between pages

        with open(output_txt_path, "w", encoding="utf-8") as f:
            f.write(full_text)

        if not os.path.exists(output_txt_path):
            raise FileNotFoundError(f"PyPDF2 did not produce the expected output file: {output_txt_path}")
        print(f"Successfully extracted text from {input_pdf_path} to {output_txt_path}.")
    except Exception as e:
        print(f"Error during PDF text extraction: {e}", file=sys.stderr)
        # Attempt to clean up partially created output file if any
        if os.path.exists(output_txt_path):
            os.remove(output_txt_path)
        sys.exit(1) # Exit with a non-zero code to indicate failure

if __name__ == "__main__":
    main()