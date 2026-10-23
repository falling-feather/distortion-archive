"""Reproduce the demo measurements and verify actual JPEG files with Pillow."""
from pathlib import Path
import json
import shutil
import subprocess
import numpy as np
from PIL import Image

root = Path(__file__).resolve().parent.parent
temporary = root / 'tmp'
temporary.mkdir(exist_ok=True)
image = Image.open(root / 'public/assets/archive-study.png').convert('RGBA')
assert image.size == (768, 512)
(temporary / 'scene-rgba.bin').write_bytes(image.tobytes())
node = shutil.which('node')
if not node:
    raise RuntimeError('Node.js 24.20.0 or newer is required.')
subprocess.run([node, '--experimental-strip-types', 'scripts/verify-scene.ts'], cwd=root, check=True)
folder = temporary / 'codec-verification'
maximum_delta = 0
errors = []
files = list(sorted(folder.glob('*.jpg')))
assert len(files) == 12
for file in files:
    decoded = Image.open(file)
    decoded.load()
    assert decoded.size == image.size
    assert file.stat().st_size <= int(file.stem.split('-')[0]) * 1024
    raw = file.with_suffix('.rgba')
    if raw.exists():
        actual = np.array(decoded.convert('RGBA'), dtype=np.int16)
        expected = np.frombuffer(raw.read_bytes(), dtype=np.uint8).reshape((512, 768, 4)).astype(np.int16)
        delta = np.abs(actual[:, :, :3] - expected[:, :, :3])
        maximum_delta = max(maximum_delta, int(delta.max()))
        errors.append(float(np.sqrt(np.mean(delta.astype(float) ** 2))))
assert len(errors) == 4 and maximum_delta <= 3
measurements = json.loads((folder / 'measurements.json').read_text(encoding='utf-8'))
report = {
    'independentDecoder': 'Pillow / libjpeg',
    'filesDecoded': len(files), 'width': image.width, 'height': image.height,
    'allWithinBudget': True, 'pixelComparisons': len(errors),
    'maximumRGBDifference': maximum_delta, 'maximumRGBRMSE': round(max(errors), 4),
    'measurements': measurements,
    'limits': 'One synthetic scene, three measured budgets. This is not a complete JPEG conformance or usability evaluation.',
}
output = root / 'output/prototype'
output.mkdir(parents=True, exist_ok=True)
(output / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
for name in ['32-letter.jpg', '32-uniform.jpg']:
    shutil.copy2(folder / name, output / name)
print(json.dumps({k: v for k, v in report.items() if k not in ['measurements']}, ensure_ascii=False))
