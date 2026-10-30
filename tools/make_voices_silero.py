"""Озвучка реплик нейросетевыми голосами Silero TTS (локально, без интернета после загрузки модели).

Читает js/lines.json, для каждой реплики синтезирует речь моделью Silero v5_6_ru
(спикер и SSML <prosody> берутся из roles[*].silero), обрезает тишину, нормализует пик
к −1 dBFS и кодирует в MP3 44,1 кГц моно 48 кбит/с встроенным кодировщиком Windows
(tools/wav_to_mp3.ps1). Результат: assets/voice/<id>.mp3 и assets/voice/voice-manifest.json.

Окружение (вне репозитория, удаляется одной папкой):
    python -m venv ..\\.venv-tts
    ..\\.venv-tts\\Scripts\\pip install torch --index-url https://download.pytorch.org/whl/cpu
    ..\\.venv-tts\\Scripts\\pip install numpy
Запуск из папки ar:
    ..\\.venv-tts\\Scripts\\python tools\\make_voices_silero.py [--only id1,id2] [--force]
Модель (≈148 МБ) скачивается с models.silero.ai в ..\\.venv-tts\\models при первом запуске.
Лицензия моделей Silero — CC BY-NC 4.0 (некоммерческое использование).
Запасной вариант без нейросети — tools/make_voices.ps1 (голоса Windows).
"""
import argparse
import io
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import wave
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent            # ar/
VENV = ROOT.parent / ".venv-tts"
MODEL_ID = "v5_6_ru"
MODEL_URL = f"https://models.silero.ai/models/tts/ru/{MODEL_ID}.pt"
SR = 48000
LICENSE = "Silero TTS models: CC BY-NC 4.0 (https://github.com/snakers4/silero-models)"


def load_model(path: Path):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"скачиваю модель {MODEL_URL} → {path}")
        with urllib.request.urlopen(MODEL_URL) as r, open(path, "wb") as f:
            shutil.copyfileobj(r, f)
    # torch.package не открывает файлы с кириллицей в пути — читаем в память
    imp = torch.package.PackageImporter(io.BytesIO(path.read_bytes()))
    model = imp.load_pickle("tts_models", "model")
    model.to(torch.device("cpu"))
    return model


def ssml(text: str, rate: str, pitch: str) -> str:
    t = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    t = t.replace("…", '<break time="250ms"/>').replace("—", ",")
    return f'<speak><prosody rate="{rate}" pitch="{pitch}">{t}</prosody></speak>'


def process(x: np.ndarray, thr_db=-45.0, keep=0.04, peak_db=-1.0):
    """моно float → обрезка тишины по краям, пик −1 dBFS, плавные края 5 мс"""
    x = x.astype(np.float64)
    peak = np.abs(x).max() or 1.0
    x = x / peak
    thr = 10 ** (thr_db / 20)
    idx = np.nonzero(np.abs(x) >= thr)[0]
    a, b = (idx[0], idx[-1]) if len(idx) else (0, len(x) - 1)
    k = int(keep * SR)
    x = x[max(0, a - k): min(len(x), b + k + 1)]
    x *= 10 ** (peak_db / 20)
    f = min(len(x) // 4, int(0.005 * SR))
    if f > 0:
        ramp = np.linspace(0, 1, f)
        x[:f] *= ramp
        x[-f:] *= ramp[::-1]
    pcm = np.clip(np.round(x * 32767), -32768, 32767).astype(np.int16)
    clipped = int(np.sum(np.abs(pcm) >= 32767))
    return pcm, len(pcm) / SR, clipped


def write_wav(path: Path, pcm: np.ndarray):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="id через запятую")
    ap.add_argument("--force", action="store_true", help="перезаписать всё")
    ap.add_argument("--model", default=str(VENV / "models" / f"{MODEL_ID}.pt"))
    ap.add_argument("--out", default=str(ROOT / "assets" / "voice"))
    args = ap.parse_args()
    only = {s for s in args.only.split(",") if s}
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    tmp = VENV / "tmp-wav"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)

    data = json.loads((ROOT / "js" / "lines.json").read_text(encoding="utf-8"))
    roles = data["roles"]
    items = []
    for set_name in ("classic", "adult"):
        for cat, lines in data[set_name].items():
            for ln in lines:
                r = roles[ln["who"]]["silero"]
                items.append({"id": ln["id"], "role": ln["who"], "text": ln.get("s") or ln["t"],
                              "voice": r["speaker"], "rate": r["rate"], "pitch": r["pitch"]})
    ids = [it["id"] for it in items]
    assert len(ids) == len(set(ids)), "повторяющиеся id в lines.json"

    man_path = out / "voice-manifest.json"
    old = {}
    if man_path.exists():
        m = json.loads(man_path.read_text(encoding="utf-8-sig"))
        if m.get("engine") == "silero" and m.get("model") == MODEL_ID:
            old = m.get("items", {})

    todo, kept = [], {}
    for it in items:
        prev = old.get(it["id"])
        same = prev and all(prev.get(k) == it[k] for k in ("text", "voice", "rate", "pitch", "role")) and (out / prev["file"]).exists()
        if (same and not args.force) or (only and it["id"] not in only and prev):
            kept[it["id"]] = prev
        elif not only or it["id"] in only:
            todo.append(it)

    torch.set_num_threads(max(1, (os.cpu_count() or 4) - 1))
    made = {}
    if todo:
        t0 = time.time()
        model = load_model(Path(args.model))
        print(f"модель {MODEL_ID} загружена за {time.time() - t0:.1f} с; реплик к записи: {len(todo)}")
        for it in todo:
            audio = model.apply_tts(ssml_text=ssml(it["text"], it["rate"], it["pitch"]), speaker=it["voice"],
                                    sample_rate=SR, put_accent=True, put_yo=True)
            pcm, dur, clipped = process(audio.numpy())
            if not (0.5 <= dur <= 7.0) or clipped:
                print(f"  ВНИМАНИЕ {it['id']}: длительность {dur:.2f} с, клиппинг {clipped}")
            write_wav(tmp / f"{it['id']}.wav", pcm)
            made[it["id"]] = {**it, "dur": round(dur, 3)}
        # кодирование в MP3 встроенным кодировщиком Windows
        ps = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "tools" / "wav_to_mp3.ps1"), "-In", str(tmp), "-Out", str(out)]
        res = subprocess.run(ps, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if res.returncode:
            sys.exit("ошибка кодирования MP3:\n" + res.stderr)
        sizes = dict(line.split("\t") for line in res.stdout.splitlines() if "\t" in line)
        for i, it in made.items():
            it["file"] = f"{i}.mp3"
            it["bytes"] = int(sizes[i])
            print(f"{i:<16} {it['voice']:<7} {it['dur']:5.2f} с {it['bytes']:7d} Б  {it['text']}")
    shutil.rmtree(tmp, ignore_errors=True)

    # удалённые из lines.json реплики — удалить файлы
    for f in out.glob("*.*"):
        if f.name != "voice-manifest.json" and f.stem not in ids:
            print("удалён:", f.name)
            f.unlink()

    out_items = {}
    for i in ids:
        it = made.get(i) or kept.get(i)
        if it:
            out_items[i] = {k: it[k] for k in ("file", "role", "voice", "text", "rate", "pitch", "dur", "bytes")}
    voices = {k: v["silero"]["speaker"] for k, v in roles.items()}
    manifest = {"format": "mp3", "engine": "silero", "model": MODEL_ID, "license": LICENSE, "voices": voices, "items": out_items}
    man_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    total = sum(v["bytes"] for v in out_items.values())
    longest = max(out_items.items(), key=lambda kv: kv[1]["dur"])
    print(f"записано {len(made)}, оставлено {len(kept)}, всего {len(out_items)} файлов, {total / 1024:.0f} КБ; "
          f"самая длинная {longest[0]} ({longest[1]['dur']:.2f} с)")


if __name__ == "__main__":
    main()
