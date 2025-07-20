import sys
import os
import tempfile
from PyPDF2 import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Define the path to the Arial.ttf file relative to this script
# Assumes arial.ttf is in a 'fonts' subdirectory within the 'scripts' directory
arial_font_path = os.path.join(os.path.dirname(__file__), 'fonts', 'arial.ttf') # Changed path

# --- DEBUGGING ADDITION: Check if font file exists ---
if not os.path.exists(arial_font_path):
    print(f"DEBUG: Arial font file NOT FOUND at expected path: {arial_font_path}", file=sys.stderr)
else:
    print(f"DEBUG: Arial font file FOUND at: {arial_font_path}", file=sys.stderr)
# --- END DEBUGGING ADDITION ---

# Register Arial font.
try:
    pdfmetrics.registerFont(TTFont('Arial', arial_font_path))
    print(f"Arial font registered from: {arial_font_path}")
except Exception as e:
    print(f"Warning: Could not register Arial font from {arial_font_path}. Falling back to Helvetica. Error: {e}", file=sys.stderr)

def add_page_numbers(input_pdf_path, output_pdf_path):
    """
    Adds page numbers to a PDF file.
    """
    try:
        reader = PdfReader(input_pdf_path)
        writer = PdfWriter()

        for i, page in enumerate(reader.pages):
            temp_overlay_filename = f"overlay_page_{i}_{os.getpid()}.pdf"
            temp_overlay_path = os.path.join(tempfile.gettempdir(), temp_overlay_filename)

            page_width = float(page.mediabox.width)
            page_height = float(page.mediabox.height)

            c = canvas.Canvas(temp_overlay_path, pagesize=(page_width, page_height))
            
            try:
                c.setFont('Arial', 15)
            except:
                c.setFont('Helvetica', 15)
            
            text_x = page_width - 0.5 * inch
            text_y = page_height - 0.5 * inch

            c.drawString(text_x, text_y, f"{i + 1}")
            c.save()

            overlay_reader = PdfReader(temp_overlay_path)
            overlay_page = overlay_reader.pages[0]

            page.merge_page(overlay_page)
            writer.add_page(page)
            
            os.remove(temp_overlay_path)

        with open(output_pdf_path, "wb") as output_file:
            writer.write(output_file)
        
        print(f"Page numbers added successfully to: {output_pdf_path}")

    except Exception as e:
        print(f"Error adding page numbers: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python add_page_numbers.py <input_pdf_path> <output_pdf_path>", file=sys.stderr)
        sys.exit(1)

    input_pdf_path = sys.argv[1]
    output_pdf_path = sys.argv[2]

    add_page_numbers(input_pdf_path, output_pdf_path)

