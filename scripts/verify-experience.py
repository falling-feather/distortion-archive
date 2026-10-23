"""Reproduce the three-scene JPEG checks with an independent Pillow decoder."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
TEMP = ROOT / "tmp" / "experience"
OUTPUT = ROOT / "output" / "review-2026-10-22"


def node(*args):
    return subprocess.run(
        [shutil.which("node") or "node", *args], cwd=ROOT,
        check=True, capture_output=True, text=True, encoding="utf-8",
        env={**os.environ, "PYTHONUTF8": "1"},
    ).stdout


def main():
    TEMP.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(node("--experimental-strip-types", "--input-type=module", "-e",
        "import {SCENES} from './src/scene.ts'; console.log(JSON.stringify(SCENES.map(s=>({id:s.id,width:s.width,height:s.height,image:s.image,priority:s.regions[0].id}))));"))
    sources = []
    for scene in manifest:
        source = ROOT / "public" / scene["image"].lstrip("/")
        with Image.open(source) as image:
            assert image.size == (scene["width"], scene["height"])
            (TEMP / f'{scene["id"]}.rgba').write_bytes(image.convert("RGBA").tobytes())
        sources.append({"scene": scene["id"], "sha256": hashlib.sha256(source.read_bytes()).hexdigest()})
    node("--experimental-strip-types", "scripts/verify-experience.ts")
    codec = json.loads((TEMP / "codec.json").read_text(encoding="utf-8"))
    decoded = []
    for scene in manifest:
        for jpeg in sorted(TEMP.glob(f'{scene["id"]}-*.jpg')):
            budget = int(jpeg.stem.split("-")[-2]) * 1024
            assert jpeg.stat().st_size <= budget, jpeg.name
            with Image.open(jpeg) as image:
                image.load()
                assert image.format == "JPEG" and image.size == (scene["width"], scene["height"])
                item = {"file": jpeg.name, "bytes": jpeg.stat().st_size, "budget": budget,
                        "sha256": hashlib.sha256(jpeg.read_bytes()).hexdigest()}
                raw = jpeg.with_suffix(".decoded")
                if raw.exists():
                    expected = np.frombuffer(raw.read_bytes(), dtype=np.uint8).reshape(scene["height"], scene["width"], 4)
                    delta = np.abs(np.asarray(image.convert("RGBA"), dtype=np.int16) - expected.astype(np.int16))
                    item["pillow_vs_worker_max_channel_delta"] = int(delta.max())
                    item["pillow_vs_worker_mean_channel_delta"] = round(float(delta.mean()), 6)
                    assert item["pillow_vs_worker_max_channel_delta"] <= 3, item
                decoded.append(item)
        for priority in ("uniform", scene["priority"]):
            name = f'{scene["id"]}-24-{priority}.jpg'
            shutil.copyfile(TEMP / name, OUTPUT / name)
    report = {"date": "2026-10-22", "scope": "Three built-in scenes; 24/32 KiB; uniform plus all three predefined regions. Pixel error is not a semantic score.",
              "sources": sources, "codec": codec, "independent_decoder": "Pillow/libjpeg", "decoded": decoded}
    (OUTPUT / "jpeg-verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"decoded_files": len(decoded), "worker_comparisons": sum("pillow_vs_worker_max_channel_delta" in item for item in decoded),
                      "max_channel_delta": max(item.get("pillow_vs_worker_max_channel_delta", 0) for item in decoded),
                      "report": str(OUTPUT / "jpeg-verification.json")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
