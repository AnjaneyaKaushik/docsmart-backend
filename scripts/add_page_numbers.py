import sys
import io
from PyPDF2 import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.units import inch

def add_page_numbers(input_pdf_path, output_pdf_path):
    """
    Adds page numbers to each page of a PDF file.
    The page number will be in the format "N" (only number),
    with font size 15, and positioned at the top right corner.
    """
    try:
        reader = PdfReader(input_pdf_path)
        writer = PdfWriter()

        for i, page in enumerate(reader.pages):
            # Create a new PDF with ReportLab for the page number
            packet = io.BytesIO()
            # Get the page size from the original PDF
            page_width = float(page.mediabox.width)
            page_height = float(page.mediabox.height)
            can = canvas.Canvas(packet, pagesize=(page_width, page_height))
            
            # Set font to Helvetica (standard and reliable) and size 15
            can.setFont('Helvetica', 15) 
            
            # Page number text format (only number)
            page_number_text = f"{i + 1}"
            
            # Calculate text width to correctly position it
            text_width = can.stringWidth(page_number_text, 'Helvetica', 15) # Use font size 15 here for accurate width
            
            # Calculate position for top-right corner, with some margin
            margin = 0.5 * inch # Using ReportLab's inch unit
            x_position = page_width - text_width - margin
            y_position = page_height - margin # Position from top

            can.drawString(x_position, y_position, page_number_text)
            can.save()

            # Merge the page number PDF with the original page
            packet.seek(0)
            number_pdf = PdfReader(packet)
            page.merge_page(number_pdf.pages[0])
            writer.add_page(page)

        with open(output_pdf_path, 'wb') as f:
            writer.write(f)
        print(f"Page numbers added successfully: {output_pdf_path}")

    except Exception as e:
        print(f"Error adding page numbers: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python add_page_numbers.py <input_pdf_path> <output_pdf_path>", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    add_page_numbers(input_path, output_path)

