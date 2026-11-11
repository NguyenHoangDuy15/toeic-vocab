import subprocess
import os
import re

# Let's search for "DAY 18", "DAY 19", etc. in PDF pages
# We can search in range 280 to 520
results = {}

for p in range(280, 520):
    jpg_path = f"/tmp/page_{p}.jpg"
    if not os.path.exists(jpg_path):
        subprocess.run(["/tmp/render_pdf", str(p)], check=True)
    res = subprocess.run(["/tmp/ocr_dump", jpg_path], capture_output=True, text=True)
    for line in res.stdout.splitlines():
        m = re.search(r'DAY\s*([0-3][0-9])', line, re.I)
        if m:
            day_num = int(m.group(1))
            if day_num not in results:
                results[day_num] = p
                print(f"FOUND DAY {day_num:02d} on PDF page {p}")

print("All found days:", sorted(results.items()))
