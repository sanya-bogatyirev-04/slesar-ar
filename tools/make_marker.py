"""
Рисует метку-генплан стройплощадки (assets/marker.png) и файл разметки зон
(js/layout.json), по которому 3D-сцена расставляет машины точно поверх схемы.

Координаты в layout.json — в системе MindAR: ширина метки = 1, центр в (0,0),
ось y направлена вверх.
"""
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H = 2048, 1448                        # пропорции A4 (альбомная)
rnd = random.Random(42)

FONT = "C:/Windows/Fonts/arialbd.ttf"
FONT_R = "C:/Windows/Fonts/arial.ttf"
f = lambda size, bold=True: ImageFont.truetype(FONT if bold else FONT_R, size)

INK = (33, 37, 51)
PAPER = (250, 246, 235)
SAND = (238, 214, 160)
PIT = (196, 150, 98)
GRASS = (150, 200, 120)
ROAD = (92, 96, 110)
CONCRETE = (205, 208, 214)
ACCENT = (240, 120, 40)

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)


def to3d(px, py):
    return round(px / W - 0.5, 4), round((H / 2 - py) / W, 4)


def hatch(box, step=22, color=INK, width=2):
    x0, y0, x1, y1 = box
    for k in range(-int(y1 - y0), int(x1 - x0), step):
        a = (x0 + max(k, 0), y0 + max(-k, 0))
        b = (x0 + min(k + (y1 - y0), x1 - x0), y0 + min(x1 - x0 - k, y1 - y0))
        d.line([a, b], fill=color, width=width)


# --- фон: миллиметровка с неравномерной нумерацией (много уникальных деталей)
for x in range(0, W, 32):
    d.line([(x, 0), (x, H)], fill=(232, 226, 210), width=1)
for y in range(0, H, 32):
    d.line([(0, y), (W, y)], fill=(232, 226, 210), width=1)
for i, x in enumerate(range(64, W, 128)):
    d.text((x + 4, H - 34), f"{chr(1040 + i % 28)}{i + 1}", font=f(18, False), fill=(150, 140, 120))
for i, y in enumerate(range(160, H - 60, 128)):
    d.text((8, y), str(i + 1), font=f(18, False), fill=(150, 140, 120))

# --- шапка
d.rectangle([0, 0, W, 112], fill=INK)
d.text((40, 22), "ГЕНПЛАН СТРОЙПЛОЩАДКИ  №3", font=f(56), fill=(255, 255, 255))
d.text((1240, 20), "Системотехника строительства", font=f(28, False), fill=(255, 210, 120))
d.text((1240, 60), "Слесарь 3-го разряда: уволить или нет?", font=f(28), fill=(255, 255, 255))
for i in range(12):
    d.rectangle([W - 40 - i * 18, 92, W - 30 - i * 18, 104], fill=ACCENT if i % 2 else (255, 255, 255))

zones = {}

# --- котлован (экскаваторы)
pit = (120, 200, 820, 690)
d.rounded_rectangle(pit, 26, fill=PIT, outline=INK, width=6)
hatch((150, 230, 790, 660), step=34, color=(170, 124, 78), width=3)
for k in range(5):  # горизонтали уступов
    d.rounded_rectangle([pit[0] + 30 + k * 26, pit[1] + 30 + k * 18, pit[2] - 30 - k * 26, pit[3] - 30 - k * 18],
                        20, outline=(120, 82, 46), width=3)
d.text((150, 210), "КОТЛОВАН  −6,0 м", font=f(36), fill=INK)
zones["excavator"] = [to3d(250 + c * 230, 380 + r * 190) for r in range(2) for c in range(3)]

# --- планировка грунта (бульдозеры)
pl = (120, 770, 820, 1180)
d.rounded_rectangle(pl, 26, fill=SAND, outline=INK, width=6)
for k in range(14):
    y = pl[1] + 70 + k * 24
    d.line([(pl[0] + 30, y), (pl[2] - 30, y + rnd.randint(-14, 14))], fill=(200, 170, 110), width=3)
d.text((150, 780), "ПЛАНИРОВКА ГРУНТА", font=f(36), fill=INK)
zones["bulldozer"] = [to3d(290 + c * 220, 990) for c in range(3)]
zones["bulldozer_path"] = [to3d(220, 990)[0], to3d(760, 990)[0]]

# --- строящийся корпус и автокраны
bz = (1130, 190, 1930, 720)
d.rounded_rectangle(bz, 26, fill=CONCRETE, outline=INK, width=6)
core = (1380, 330, 1680, 580)
d.rectangle(core, fill=(150, 156, 170), outline=INK, width=6)
for i in range(1, 5):
    d.line([(core[0] + i * 60, core[1]), (core[0] + i * 60, core[3])], fill=INK, width=2)
for j in range(1, 4):
    d.line([(core[0], core[1] + j * 62), (core[2], core[1] + j * 62)], fill=INK, width=2)
d.text((1410, 590), "КОРПУС «Б»", font=f(34), fill=INK)
d.text((1160, 200), "МОНТАЖНАЯ ЗОНА", font=f(36), fill=INK)
cranes = [(1250, 300), (1810, 300), (1250, 620), (1810, 620)]
for i, (x, y) in enumerate(cranes):
    d.ellipse([x - 70, y - 70, x + 70, y + 70], outline=ACCENT, width=5)
    d.ellipse([x - 12, y - 12, x + 12, y + 12], fill=ACCENT)
    d.text((x - 22, y + 74 if i < 2 else y - 112), f"К{i + 1}", font=f(28), fill=INK)
zones["crane"] = [to3d(x, y) for x, y in cranes]
zones["building"] = {"center": to3d(1530, 455), "size": [300 / W, 250 / W]}

# --- кольцевая дорога (самосвалы)
road_c = (1380, 1010)
rx, ry = 470, 200
d.ellipse([road_c[0] - rx - 46, road_c[1] - ry - 46, road_c[0] + rx + 46, road_c[1] + ry + 46], fill=ROAD)
d.ellipse([road_c[0] - rx + 46, road_c[1] - ry + 46, road_c[0] + rx - 46, road_c[1] + ry - 46], fill=GRASS, outline=INK, width=4)
for k in range(48):
    a = 2 * math.pi * k / 48
    x, y = road_c[0] + rx * math.cos(a), road_c[1] + ry * math.sin(a)
    if k % 2 == 0:
        d.ellipse([x - 6, y - 6, x + 6, y + 6], fill=(255, 230, 120))
d.text((road_c[0] - 200, road_c[1] - 30), "ВЫВОЗ ГРУНТА", font=f(40), fill=INK)
d.text((road_c[0] - 150, road_c[1] + 22), "кольцо 1,2 км", font=f(28, False), fill=INK)
zones["truck_loop"] = {"center": to3d(*road_c), "rx": rx / W, "ry": ry / W}

# --- вагончик слесарей (база ремонтников)
tr = (880, 580, 1080, 740)
d.rounded_rectangle(tr, 16, fill=(90, 140, 220), outline=INK, width=6)
d.text((898, 600), "РЕМОНТ", font=f(34), fill=(255, 255, 255))
d.text((904, 650), "слесари", font=f(30, False), fill=(255, 255, 255))
d.polygon([(980, 690), (1010, 730), (950, 730)], fill=(255, 220, 80))
zones["base"] = to3d(980, 790)

# --- деревья, бытовки, указатели — «шум» для надёжного распознавания
for _ in range(40):
    x, y = rnd.randint(860, 1100), rnd.randint(140, 540)
    if rnd.random() < 0.5:
        r = rnd.randint(12, 26)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(90, 160, 90), outline=INK, width=3)
    else:
        d.rectangle([x - 14, y - 9, x + 14, y + 9], fill=(250, 200, 80), outline=INK, width=2)
for _ in range(30):
    x, y = rnd.randint(850, 1110), rnd.randint(800, 1360)
    if not (900 < x < 1000 and 880 < y < 1140):
        r = rnd.randint(10, 22)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(110, 175, 100), outline=INK, width=3)

# компас
cx, cy = 1990, 1300
d.ellipse([cx - 44, cy - 44, cx + 44, cy + 44], outline=INK, width=4)
d.polygon([(cx, cy - 40), (cx + 14, cy), (cx, cy + 40), (cx - 14, cy)], fill=INK)
d.text((cx - 10, cy - 82), "С", font=f(28), fill=INK)

# масштабная линейка
for i in range(6):
    d.rectangle([140 + i * 70, 1250, 210 + i * 70, 1272], fill=INK if i % 2 == 0 else PAPER, outline=INK, width=2)
d.text((140, 1280), "0     10    20    30    40    50  м", font=f(24, False), fill=INK)
d.text((140, 1330), "Наведите камеру на схему — площадка оживёт", font=f(30), fill=ACCENT)

d.rectangle([4, 4, W - 5, H - 5], outline=INK, width=8)

(ROOT / "assets").mkdir(exist_ok=True)
img.save(ROOT / "assets" / "marker.png", optimize=True)
rect3d = lambda x0, y0, x1, y1: [*to3d(x0, y0), *to3d(x1, y1)]   # [x0, yTop, x1, yBottom]
zones["pit_rect"] = rect3d(170, 270, 790, 660)
zones["plan_rect"] = rect3d(160, 850, 780, 1150)
zones["build_rect"] = rect3d(1180, 260, 1880, 680)
zones["trailer"] = to3d(980, 660)
zones["trees"] = [to3d(x, y) for x, y in [(850, 190), (935, 185), (880, 365), (955, 400), (1015, 408), (1072, 850), (1056, 785), (1040, 993), (878, 878), (838, 1010)]]
layout = {"aspect": H / W, "zones": zones}
(ROOT / "js" / "layout.json").write_text(json.dumps(layout, ensure_ascii=False, indent=1), encoding="utf-8")
print("ok", img.size)
