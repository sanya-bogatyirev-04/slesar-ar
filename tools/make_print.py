"""Лист А4 для печати: схема-метка + QR-код со ссылкой на сайт (assets/marker-print.pdf)."""
import sys
from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
URL = sys.argv[1] if len(sys.argv) > 1 else "https://sanya-bogatyirev-04.github.io/slesar-ar/"
DPI = 200
mm = lambda v: round(v / 25.4 * DPI)

page = Image.new("RGB", (mm(297), mm(210)), "white")
d = ImageDraw.Draw(page)
marker = Image.open(ROOT / "assets" / "marker.png")
mw = mm(250)
marker = marker.resize((mw, round(mw * marker.height / marker.width)), Image.LANCZOS)
top = (page.height - marker.height) // 2
page.paste(marker, (mm(8), top))

qr = qrcode.QRCode(border=1, box_size=10, error_correction=qrcode.constants.ERROR_CORRECT_M)
qr.add_data(URL)
qimg = qr.make_image(fill_color="#1f2433", back_color="white").convert("RGB").resize((mm(31), mm(31)), Image.NEAREST)
x0 = mm(8) + mw + mm(4)
page.paste(qimg, (x0, top))

f = lambda s, b=True: ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf" if b else "C:/Windows/Fonts/arial.ttf", s)
lines = [("1. Отсканируйте", True), ("QR-код", True), ("", False), ("2. Нажмите", True), ("«AR — на схеме»", False),
         ("", False), ("3. Наведите камеру", True), ("на схему", False), ("", False), ("Площадка", True), ("оживёт!", True)]
y = top + mm(35)
for text, bold in lines:
    d.text((x0, y), text, font=f(mm(3.1), bold), fill="#1f2433")
    y += mm(4.6)
d.text((x0, top + marker.height - mm(9)), "Печатать без", font=f(mm(2.5), False), fill="#6b7183")
d.text((x0, top + marker.height - mm(5)), "масштабирования", font=f(mm(2.5), False), fill="#6b7183")

page.save(ROOT / "assets" / "marker-print.pdf", resolution=DPI)
qimg.save(ROOT / "assets" / "qr.png")
print("ok", URL)
