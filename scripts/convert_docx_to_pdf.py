import subprocess
import os
import sys

input_file = sys.argv[1]
output_dir = sys.argv[2]

try:
    # Use 'soffice' instead of 'libreoffice'
    result = subprocess.run([
        "soffice",
        "--headless",
        "--convert-to", "pdf",
        "--outdir", output_dir,
        input_file
    ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    print(result.stdout.decode())
except subprocess.CalledProcessError as e:
    print("DOCX to PDF conversion failed:", e.stderr.decode(), file=sys.stderr)
    sys.exit(1)
except Exception as ex:
    print("DOCX to PDF conversion failed:", str(ex), file=sys.stderr)
    sys.exit(1)