# TIMS Drawing Intelligence

Engineering drawing to BOM extraction that runs **entirely in your browser**.

**Open the app:** https://rachanachandrashekar5-bot.github.io/Rachana/

* Upload an as built drawing (PDF, PNG, JPG, TIFF) and its Bill of Materials (PDF);
  download an Excel workbook listing every callout with its BOM details.
* **Your files never leave your device.** They are read and processed by this
  web page on your own computer or phone; nothing is uploaded, stored or shared.
  The site only downloads the application itself (about 39 MB on the first
  visit, cached afterwards).
* Works in current Chrome, Edge, Safari and Firefox, on laptops and phones.

This repository contains only the built website. Third-party components:
Pyodide (MPL-2.0), NumPy (BSD), OpenCV (Apache-2.0), Pillow (MIT-CMU),
openpyxl (MIT), Tesseract OCR / tesseract.js-core (Apache-2.0),
pdf.js (Apache-2.0), React (MIT), EB Garamond font (OFL).
