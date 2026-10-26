"""Optional fixture generator. Requires ReportLab, not used by the web app.

Use ReportLab's ECC200 error correction and placement independently of the JS
reader. Supply GS1 ASCII codewords explicitly: its built-in C40 encoder uses
fake padding that can add a NUL to some payloads.
"""
import json
from pathlib import Path
from reportlab.graphics.barcode.ecc200datamatrix import ECC200DataMatrix


class GS1DataMatrix(ECC200DataMatrix):
    def _encode_c40(self, value):
        # ReportLab calls this hook; return Data Matrix ASCII-mode codewords.
        codewords = []
        offset = 0
        while offset < len(value):
            if value[offset] == "\x1d":
                codewords.append(232)  # FNC1, both leading and field separator
                offset += 1
            elif value[offset:offset + 2].isdigit() and len(value[offset:offset + 2]) == 2:
                codewords.append(130 + int(value[offset:offset + 2]))
                offset += 2
            else:
                codewords.append(ord(value[offset]) + 1)
                offset += 1
        if len(codewords) > self.cw_data:
            raise ValueError("Payload does not fit fixture")
        if len(codewords) < self.cw_data:
            codewords.append(129)
        while len(codewords) < self.cw_data:
            padding = 129 + ((149 * (len(codewords) + 1)) % 253) + 1
            codewords.append(padding - 254 if padding > 254 else padding)
        return codewords


value = "\x1d01003829032490391730053111250601105129147"
barcode = GS1DataMatrix(value)
barcode.validate()
barcode.encode()
fixture = {
    "generator": "ReportLab ECC200 placement/error correction; GS1 ASCII/FNC1, 44x44; row zero is bottom",
    "text": value,
    "rows": ["".join(str(pixel) for pixel in row) for row in barcode.encoded],
}
Path(__file__).with_name("datamatrix.json").write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
