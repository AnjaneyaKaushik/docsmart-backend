# scripts/add_page_numbers.py

import sys
import os
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import io

def add_page_numbers(input_pdf_path, output_pdf_path, font_name="Arial", font_size=14, margin_top=30, margin_right=30):
    try:
        # --- Font Registration Start ---
        arial_font_path = os.path.join(os.path.dirname(__file__), 'fonts', 'Arial.ttf')

        if not os.path.exists(arial_font_path):
            print(f"Error: Arial font file not found at {arial_font_path}. Falling back to Helvetica.", file=sys.stderr)
            font_name = "Helvetica"
        else:
            try:
                pdfmetrics.registerFont(TTFont('Arial', arial_font_path))
                pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='Arial-Bold', italic='Arial-Italic', boldItalic='Arial-BoldItalic')
                print(f"Registered Arial font from {arial_font_path}")
            except Exception as e:
                print(f"Warning: Could not register Arial font from {arial_font_path}. Error: {e}. Falling back to Helvetica.", file=sys.stderr)
                font_name = "Helvetica"
        # --- Font Registration End ---

        reader = PdfReader(input_pdf_path)
        writer = PdfWriter()

        num_pages = len(reader.pages)

        for i in range(num_pages):
            page = reader.pages[i]
            
            page_width = float(page.mediabox[2])
            page_height = float(page.mediabox[3])

            packet = io.BytesIO()
            can = canvas.Canvas(packet, pagesize=(page_width, page_height)) 

            page_num_str = f"{i + 1}"

            text_width = pdfmetrics.stringWidth(page_num_str, font_name, font_size)
            
            x_position = page_width - margin_right - text_width 
            y_position = page_height - margin_top - font_size 

            can.setFont(font_name, font_size)
            can.drawString(x_position, y_position, page_num_str)
            can.save()
            packet.seek(0)
            
            overlay_pdf_reader = PdfReader(packet)
            overlay_page = overlay_pdf_reader.pages[0]

            page.merge_page(overlay_page)
            writer.add_page(page)

        with open(output_pdf_path, "wb") as output_file:
            writer.write(output_file)

        print(f"Page numbers added successfully to: {output_pdf_path}")
        sys.exit(0)
    except Exception as e:
        print(f"Error adding page numbers: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python add_page_numbers.py <input_pdf_path> <output_pdf_path>", file=sys.stderr)
        sys.exit(1)
    
    input_pdf_path = sys.argv[1]
    output_pdf_path = sys.argv[2]
    
    # Font size increased to 14 here
    add_page_numbers(input_pdf_path, output_pdf_path, font_name="Arial", font_size=14)