import sys
import os
import tempfile # Import tempfile module
from PyPDF2 import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter # Or whatever page size is appropriate
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont # Import TTFont

# Define the path to the Arial.ttf file relative to this script
# Assumes Arial.ttf is in a 'fonts' subdirectory within the 'scripts' directory
# E.g., your-project-root/scripts/fonts/Arial.ttf
arial_font_path = os.path.join(os.path.dirname(__file__), 'fonts', 'Arial.ttf')

# Register Arial font.
try:
    pdfmetrics.registerFont(TTFont('Arial', arial_font_path))
    print(f"Arial font registered from: {arial_font_path}")
except Exception as e:
    print(f"Warning: Could not register Arial font from {arial_font_path}. Falling back to Helvetica. Error: {e}", file=sys.stderr)
    # Fallback to Helvetica if Arial is not found or cannot be registered.
    # For robustness, you might want to explicitly handle this fallback or ensure font presence.

def add_page_numbers(input_pdf_path, output_pdf_path):
    """
    Adds page numbers to a PDF file.
    """
    try:
        reader = PdfReader(input_pdf_path)
        writer = PdfWriter()

        # Iterate through each page
        for i, page in enumerate(reader.pages):
            # Create a temporary PDF for the page number overlay
            # Use a unique name to avoid conflicts, and ensure it's in a temp directory
            temp_overlay_filename = f"overlay_page_{i}_{os.getpid()}.pdf"
            # Corrected: Use tempfile.gettempdir() instead of os.tmpdir()
            temp_overlay_path = os.path.join(tempfile.gettempdir(), temp_overlay_filename)

            # Create a canvas for the overlay
            # Get page dimensions to position text correctly
            page_width = page.mediabox.width
            page_height = page.mediabox.height

            c = canvas.Canvas(temp_overlay_path, pagesize=(page_width, page_height))
            
            # Set font and size. Attempt to use 'Arial', fallback to 'Helvetica' if registration failed.
            try:
                c.setFont('Arial', 15) # Changed font size to 15
            except:
                c.setFont('Helvetica', 15) # Fallback if Arial not found/registered, also set to 15
            
            # Position the page number at the bottom center
            # Adjust x_pos and y_pos as needed for different placements
            text_x = page_width / 2
            text_y = 0.5 * inch # 0.5 inch from the bottom

            # Draw the string. 'c.drawCentredString' can be used for centering.
            c.drawCentredString(text_x, text_y, f"Page {i + 1}")
            c.save()

            # Merge the overlay with the original page
            overlay_reader = PdfReader(temp_overlay_path)
            overlay_page = overlay_reader.pages[0]

            page.merge_page(overlay_page)
            writer.add_page(page)
            
            # Clean up the temporary overlay file
            os.remove(temp_overlay_path)

        # Write the combined PDF to the output path
        with open(output_pdf_path, "wb") as output_file:
            writer.write(output_file)
        
        print(f"Page numbers added successfully to: {output_pdf_path}")

    except Exception as e:
        print(f"Error adding page numbers: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    # The script expects two arguments: input_pdf_path and output_pdf_path
    if len(sys.argv) != 3:
        print("Usage: python add_page_numbers.py <input_pdf_path> <output_pdf_path>", file=sys.stderr)
        sys.exit(1)

    input_pdf_path = sys.argv[1]
    output_pdf_path = sys.argv[2]

    add_page_numbers(input_pdf_path, output_pdf_path)

