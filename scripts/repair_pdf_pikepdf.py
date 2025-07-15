# src/scripts/repair_pdf_pikepdf.py

import sys
import pikepdf

def repair_pdf(input_path, output_path):
    try:
        # Open the PDF. pikepdf's open/save process inherently repairs many corruptions.
        # It attempts to fix issues it encounters during parsing.
        pdf = pikepdf.open(input_path)
        
        # Save the PDF to a new file. This re-serializes the PDF,
        # often resolving structural issues.
        pdf.save(output_path)
        
        print(f"PDF successfully repaired and saved to: {output_path}")
        sys.exit(0) # Indicate success
    except pikepdf.PdfError as e:
        print(f"Error repairing PDF with pikepdf: {e}", file=sys.stderr)
        sys.exit(1) # Indicate failure due to pikepdf error
    except Exception as e:
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        sys.exit(1) # Indicate general failure

if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Usage: python repair_pdf_pikepdf.py <input_pdf_path> <output_pdf_path>", file=sys.stderr)
        sys.exit(1)
    
    input_pdf_path = sys.argv[1]
    output_pdf_path = sys.argv[2]
    repair_pdf(input_pdf_path, output_pdf_path)