# scripts/add_watermark.py
import sys
import os
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch # Import inch for easier positioning
from PyPDF2 import PdfReader, PdfWriter # Import PyPDF2 for PDF manipulation

def create_watermark_pdf(watermark_text, font_size, opacity, rotation, output_wm_pdf):
    """Creates a temporary PDF with the watermark text using ReportLab."""
    c = canvas.Canvas(output_wm_pdf, pagesize=letter)
    c.setFont("Helvetica", font_size)
    
    # Set fill color with opacity
    c.setFillColorRGB(0, 0, 0, alpha=opacity) 

    # Get page dimensions
    width, height = letter

    # Position for diagonally centered watermark
    # Move origin to the center of the page
    c.translate(width / 2, height / 2)
    # Apply rotation
    c.rotate(rotation)
    
    # Calculate text width to center it
    text_width = c.stringWidth(watermark_text, "Helvetica", font_size)
    
    # Draw the string. Position it so its center is at the current origin (which is page center, rotated).
    # The -text_width / 2 centers it horizontally.
    # The -font_size / 2 centers it vertically (roughly, as font_size is height).
    c.drawString(-text_width / 2, -font_size / 2, watermark_text) 

    c.save()

def add_watermark_to_pdf(input_pdf_path, output_pdf_path):
    """
    Adds a hardcoded text watermark to a PDF using PyPDF2.
    
    Args:
        input_pdf_path (str): Path to the input PDF file.
        output_pdf_path (str): Path to save the watermarked PDF file.
    """
    # Hardcoded watermark parameters as per your request
    watermark_text = "Processed by DocSmart"
    font_size = 40 # Changed to 40
    opacity = 0.2
    rotation = 45 # Changed to 45 for diagonal placement

    # Create a temporary PDF for the watermark
    temp_watermark_pdf_path = f"{os.path.splitext(input_pdf_path)[0]}_temp_watermark_{os.getpid()}.pdf"
    try:
        create_watermark_pdf(watermark_text, font_size, opacity, rotation, temp_watermark_pdf_path)

        # Open the original PDF and the watermark PDF
        reader = PdfReader(input_pdf_path)
        watermark_reader = PdfReader(temp_watermark_pdf_path)
        watermark_page = watermark_reader.pages[0] # Get the first page of the watermark PDF

        writer = PdfWriter()

        # Iterate through each page of the original PDF and overlay the watermark
        for i in range(len(reader.pages)):
            page = reader.pages[i]
            # Merge the watermark page onto the current page
            page.merge_page(watermark_page)
            writer.add_page(page)
        
        # Save the modified PDF
        with open(output_pdf_path, "wb") as output_file:
            writer.write(output_file)
        
        print(f"Watermark added successfully to {output_pdf_path}")
        return True

    except Exception as e:
        print(f"Error adding watermark: {e}", file=sys.stderr)
        return False
    finally:
        # Clean up the temporary watermark PDF
        if os.path.exists(temp_watermark_pdf_path):
            os.remove(temp_watermark_pdf_path)

if __name__ == "__main__":
    if len(sys.argv) != 3: # Expecting only input_pdf_path and output_pdf_path
        print("Usage: python add_watermark.py <input_pdf_path> <output_pdf_path>", file=sys.stderr)
        sys.exit(1)

    input_pdf = sys.argv[1]
    output_pdf = sys.argv[2]

    if add_watermark_to_pdf(input_pdf, output_pdf):
        sys.exit(0)
    else:
        sys.exit(1)
