import sys
from pikepdf import Pdf, Encryption

def protect_pdf(input_path, output_path, password):
    """
    Protects a PDF file with a user password using AES-256 encryption.
    """
    try:
        pdf = Pdf.open(input_path)
        # Set user and owner passwords, and specify AES-256 encryption (R=6)
        # Permissions are set to default, which means no permissions unless specified.
        # For full restriction, you might explicitly set permissions=pikepdf.Permissions.none
        pdf.save(output_path,
                 encryption=Encryption(
                     user=password,
                     owner=password, # Using same password for owner for simplicity
                     R=6 # AES-256 encryption (R=6 is the highest strength in pikepdf)
                 ))
        print(f"PDF protected successfully: {output_path}")
    except Exception as e:
        print(f"Error protecting PDF: {e}", file=sys.stderr)
        sys.exit(1)

def unlock_pdf(input_path, output_path, password):
    """
    Unlocks a password-protected PDF file.
    """
    try:
        # Open with user password
        # pikepdf will attempt to decrypt using the provided password
        pdf = Pdf.open(input_path, password=password)
        # Save without encryption (effectively removing the password)
        pdf.save(output_path)
        print(f"PDF unlocked successfully: {output_path}")
    except Exception as e:
        print(f"Error unlocking PDF: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    # Expected arguments: action (protect/unlock), input_path, output_path, password
    if len(sys.argv) < 5:
        print("Usage: python protect_pdf.py <action> <input_path> <output_path> <password>", file=sys.stderr)
        sys.exit(1)

    action = sys.argv[1]
    input_path = sys.argv[2]
    output_path = sys.argv[3]
    password = sys.argv[4]

    if action == "protect":
        protect_pdf(input_path, output_path, password)
    elif action == "unlock":
        unlock_pdf(input_path, output_path, password)
    else:
        print(f"Unknown action: {action}", file=sys.stderr)
        sys.exit(1)

