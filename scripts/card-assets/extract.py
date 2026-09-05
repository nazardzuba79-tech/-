"""Deterministic recovery from the two owner-supplied composites. No AI models.

Usage: python extract.py --black-reference FILE --titanium-reference FILE
Requires Pillow, numpy and opencv-python-headless. See docs/PHYSICAL_CARDS.md.
"""
import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'frontend/public/cards'


def rectify(path, corners, size):
    source = np.array(Image.open(path).convert('RGB'))
    w, h = size
    homography = cv2.getPerspectiveTransform(np.float32(corners), np.float32([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]]))
    return cv2.warpPerspective(source, homography, size, flags=cv2.INTER_CUBIC), homography


def exterior(size, radius):
    # Supersampled silhouette only; no face graphics are drawn by the frontend.
    w, h = size
    mask = Image.new('L', (w*4, h*4))
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w*4-1, h*4-1), radius=radius*4, fill=255)
    return np.array(mask.resize(size, Image.Resampling.LANCZOS))


def network_mask(rgb):
    h, w = rgb.shape[:2]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    y, x = np.indices((h, w))
    # Restricted to the known lower-right mark. Never selects the rainbow ring.
    selected = ((x > w*.77) & (y > h*.64) & (hsv[:, :, 1] > 145) & ((hsv[:, :, 0] < 40) | (hsv[:, :, 0] > 170)))
    return cv2.dilate(selected.astype('uint8')*255, np.ones((11, 11), np.uint8))


def fill_hidden(rgb, mask):
    """Harmonic material continuation, constrained by the visible boundary.

    Large foreground occlusion is excluded before solving. No learned priors,
    synthesized logo/chip or semantic completion. Visible RGB stays untouched.
    """
    small = cv2.resize(rgb.astype('float32'), (250, 158), interpolation=cv2.INTER_AREA)
    hidden = cv2.resize(mask, (250, 158), interpolation=cv2.INTER_NEAREST) > 0
    small[hidden] = np.median(small[~hidden], axis=0)
    for _ in range(6500):
        smooth = cv2.blur(small, (3, 3), borderType=cv2.BORDER_REFLECT)
        small[hidden] = smooth[hidden]
    material = cv2.resize(small, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_CUBIC)
    # Fine residual texture sampled from a visible, plain titanium patch.
    patch = rgb[30:55, 460:478].astype('float32')
    texture = patch - cv2.GaussianBlur(patch, (5, 5), 0)
    tiles = np.tile(texture, (int(rgb.shape[0]/25)+1, int(rgb.shape[1]/18)+1, 1))[:rgb.shape[0], :rgb.shape[1]]
    material += tiles*.35
    out = rgb.copy()
    out[mask > 0] = np.clip(material[mask > 0], 0, 255).astype('uint8')
    return out


def continue_grooves(rgb, hidden):
    """Continue the two visible lower-left groove tangents under the occluder.

    These paths are an explicit approximation ONLY in the hidden region. They
    are not claimed to recover unseen original artwork. Ring/logo/chip untouched.
    """
    coverage = np.zeros(hidden.shape, np.uint8)
    for points, width in [
        ([[297, -20], [78, 135], [132, 400], [264, 556]], 21),
        ([[465, 9], [269, 125], [302, 389], [431, 540]], 17),
    ]:
        p = np.array(points, dtype='float32')
        t = np.linspace(0, 1, 240)[:, None]
        curve = ((1-t)**3*p[0] + 3*(1-t)**2*t*p[1] + 3*(1-t)*t**2*p[2] + t**3*p[3]).astype('int32')
        cv2.polylines(coverage, [curve], False, 255, width, cv2.LINE_AA)
    coverage = cv2.GaussianBlur(coverage, (3, 3), .65).astype('float32') / 255
    coverage[hidden == 0] = 0
    return np.clip(rgb.astype('float32') - coverage[:, :, None]*9, 0, 255).astype('uint8')


def remove_mark(rgb, mask):
    # Harmonic interpolation from surrounding material avoids directional
    # smears from large-hole Navier-Stokes inpainting. No invented symbol.
    y, x = np.where(mask > 0)
    left, right = max(0, x.min()-12), min(rgb.shape[1], x.max()+13)
    top, bottom = max(0, y.min()-12), min(rgb.shape[0], y.max()+13)
    patch = rgb[top:bottom, left:right].astype('float32')
    hole = mask[top:bottom, left:right] > 0
    patch[hole] = np.mean(patch[~hole], axis=0)
    for _ in range(4000):
        smooth = cv2.blur(patch, (3, 3), borderType=cv2.BORDER_REFLECT)
        patch[hole] = smooth[hole]
    result = rgb.copy()
    target = result[top:bottom, left:right]
    target[hole] = np.clip(patch[hole], 0, 255).astype('uint8')
    return result


def save(name, original, repaired, alpha, modified, hidden, source, corners, matrix):
    # Pixel preservation is measured against the geometrically resampled source,
    # not against unwarped coordinates (perspective correction resamples pixels).
    preserved = (modified == 0) & (alpha == 255)
    assert np.array_equal(original[preserved], repaired[preserved])
    rgba = np.dstack((repaired, alpha))
    master = Image.fromarray(rgba)
    master.save(DEST / f'voltex-{name}.png', optimize=True)
    master.save(DEST / f'voltex-{name}.webp', lossless=True, method=6)
    # Review overlays identify ALL repairs, with hidden-region provenance distinct.
    overlay = np.zeros_like(rgba)
    overlay[modified > 0] = (225, 119, 42, 150)
    overlay[hidden > 0] = (70, 130, 220, 150)
    overlay[:, :, 3] = np.minimum(overlay[:, :, 3], alpha)
    Image.fromarray(overlay).save(DEST / f'voltex-{name}-repair-map.png', optimize=True)
    area = alpha == 255
    return {
        'sourceFilename': source.name, 'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'cornersTLTRBRBL': corners, 'size': [master.width, master.height], 'homography': matrix.tolist(),
        'preservedOpaquePercent': round(100*preserved.sum()/area.sum(), 2),
        'hiddenOpaquePercent': round(100*((hidden > 0) & area).sum()/area.sum(), 2),
        'maxPreservedChannelDifference': 0, 'generativeModelUsed': False,
        'masterSha256': hashlib.sha256((DEST / f'voltex-{name}.png').read_bytes()).hexdigest(),
    }


def run(black_path, titanium_path):
    DEST.mkdir(parents=True, exist_ok=True)
    report = {}
    black_corners = [[288, 421], [907, 586], [740, 1007], [78, 801]]
    black, matrix = rectify(black_path, black_corners, (1000, 630))
    mark = network_mask(black)
    repaired = remove_mark(black, mark)
    report['black-signature'] = save('black-signature', black, repaired, exterior((1000, 630), 34), mark, np.zeros_like(mark), black_path, black_corners, matrix)

    titanium_corners = [[706, 460], [1156, 602], [1018, 962], [562, 777]]
    # Work at a common reference coordinate grid before one final save. The
    # output is modestly resampled, never AI-upscaled/sharpened or recoloured.
    titanium, matrix = rectify(titanium_path, titanium_corners, (1000, 630))
    hidden = np.zeros((630, 1000), np.uint8)
    # Foreground black card INCLUDING its thin bright edge; remaining source
    # Titanium pixels outside this explicit polygon are preserved.
    cv2.fillPoly(hidden, [np.array([[0,0],[448,0],[448,482],[437,510],[417,528],[380,540],[0,565]], np.int32)], 255)
    repaired = fill_hidden(titanium, hidden)
    repaired = continue_grooves(repaired, hidden)
    mark = network_mask(titanium)
    # Only the lower-right network mark belongs to Titanium. Foreground mark
    # pixels lie inside the occlusion and are removed by the material fill.
    repaired = remove_mark(repaired, mark)
    modified = np.maximum(hidden, mark)
    report['titanium'] = save('titanium', titanium, repaired, exterior((1000, 630), 37), modified, hidden, titanium_path, titanium_corners, matrix)
    (DEST / 'physical-card-provenance.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--black-reference', type=Path, required=True)
    parser.add_argument('--titanium-reference', type=Path, required=True)
    args = parser.parse_args()
    run(args.black_reference, args.titanium_reference)
