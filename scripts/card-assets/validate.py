"""Read-only artifact validation against the original supplied images."""
import argparse
import hashlib
import json
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--references', type=Path, required=True)
args = parser.parse_args()
assets = Path(__file__).resolve().parents[2] / 'frontend/public/cards'
report = json.loads((assets / 'physical-card-provenance.json').read_text())
for variant, meta in report.items():
    source = args.references / meta['sourceFilename']
    assert hashlib.sha256(source.read_bytes()).hexdigest() == meta['sourceSha256']
    path = assets / f'voltex-{variant}.png'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == meta['masterSha256']
    master = Image.open(path)
    assert master.mode == 'RGBA' and master.size == (1000, 630)
    rgba = np.array(master)
    alpha = rgba[:, :, 3]
    assert all(alpha[y, x] == 0 for x, y in [(0,0), (999,0), (0,629), (999,629)])
    assert alpha[315, 500] == 255 and ((alpha > 0) & (alpha < 255)).any()
    webp = np.array(Image.open(assets / f'voltex-{variant}.webp').convert('RGBA'))
    assert np.array_equal(rgba[alpha > 0], webp[alpha > 0]), 'WebP must preserve visible RGBA exactly'
    repairs = np.array(Image.open(assets / f'voltex-{variant}-repair-map.png'))
    untouched = (repairs[:, :, 3] == 0) & (alpha == 255)
    warped = cv2.warpPerspective(np.array(Image.open(source).convert('RGB')), np.array(meta['homography']), (1000,630), flags=cv2.INTER_CUBIC)
    assert np.array_equal(rgba[:, :, :3][untouched], warped[untouched]), 'Unmasked source pixels changed'
    # Known original payment-mark region must contain no saturated red/orange.
    hsv = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2HSV)[420:600, 780:980]
    assert not ((hsv[:, :, 1] > 145) & ((hsv[:, :, 0] < 40) | (hsv[:, :, 0] > 170))).any()
    assert meta['generativeModelUsed'] is False
    print(f'{variant}: PASS; RGBA, ratio, alpha, hashes, lossless WebP, source-pixel equality, mark removal')
