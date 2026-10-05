"""Attach exact capture inventories to the compiled whitepaper without altering pages."""
from pathlib import Path
from pypdf import PdfReader,PdfWriter
ROOT=Path(__file__).resolve().parents[3]
PDF=ROOT/'output/pdf/AlphaEngine_Whitepaper_Features_and_Interactions.pdf'
w=PdfWriter(clone_from=PDF)
names=['view-manifest.json','supplementary-views.json','source-controls.json','shutdown-status.json','github-workflows.json','strategy-catalogue.json','feature-methods.json','verification-report.json','route-verification.json','screenshot-audit.json','live-verification.json']
for name in names:
 w.add_attachment(name,(ROOT/'docs/whitepaper/evidence'/name).read_bytes())
tmp=PDF.with_suffix('.attached.pdf')
with tmp.open('wb') as f:w.write(f)
tmp.replace(PDF)
assert len(PdfReader(PDF).attachments)==len(names)
(ROOT/'docs/whitepaper/AlphaEngine_Institutional_Whitepaper.pdf').write_bytes(PDF.read_bytes())
print(f'Embedded {len(names)} evidence files and updated the repository whitepaper.')
