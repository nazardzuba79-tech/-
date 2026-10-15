#!/usr/bin/env python3
# Usage: python3 scripts/cfd-marks/generate.py frontend/src/assets/cfd-marks
# Generates the CFD base-asset marks (precious-metal ingot stacks, crude-oil drops) as self-contained SVGs.
import os, sys
out = sys.argv[1]

def ingot(cx, yb, w=25, top=17.5, h=12.5, lip=3.2):
    """Front face, top face and a shine line of one ingot seen slightly from above."""
    x0, x1 = cx - w/2, cx + w/2
    t0, t1 = cx - top/2, cx + top/2
    yt = yb - h
    front = f"M{x0:.2f} {yb:.2f}L{x1:.2f} {yb:.2f}L{t1:.2f} {yt:.2f}L{t0:.2f} {yt:.2f}Z"
    topf = f"M{t0:.2f} {yt:.2f}L{t1:.2f} {yt:.2f}L{t1-1.6:.2f} {yt-lip:.2f}L{t0+1.6:.2f} {yt-lip:.2f}Z"
    shine = f"M{t0+1.2:.2f} {yt+2.2:.2f}L{t1-3.2:.2f} {yt+2.2:.2f}"
    return front, topf, shine

def metal(name, bg_hi, bg_lo, face_hi, face_lo, top, edge, shine="#ffffff"):
    bars = [ingot(19.4, 47.2), ingot(44.6, 47.2), ingot(32, 32.6)]
    body = []
    for i, (front, topf, sh) in enumerate(bars):
        body.append(f'<path d="{topf}" fill="{top}" stroke="{edge}" stroke-width="1.5" stroke-linejoin="round"/>')
        body.append(f'<path d="{front}" fill="url(#f)" stroke="{edge}" stroke-width="1.5" stroke-linejoin="round"/>')
        body.append(f'<path d="{sh}" stroke="{shine}" stroke-opacity=".8" stroke-width="1.6" stroke-linecap="round"/>')
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="b" x1="14" y1="6" x2="50" y2="60" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{bg_hi}"/><stop offset="1" stop-color="{bg_lo}"/></linearGradient><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{face_hi}"/><stop offset="1" stop-color="{face_lo}"/></linearGradient></defs><circle cx="32" cy="32" r="32" fill="url(#b)"/>{''.join(body)}</svg>'''
    open(os.path.join(out, f'{name}.svg'), 'w').write(svg)

def oil(name, bg_hi, bg_lo, ring):
    drop = "M32 9.5C26.6 18.8 16.4 28.6 16.4 38.4a15.6 15.6 0 0 0 31.2 0C47.6 28.6 37.4 18.8 32 9.5Z"
    shine = "M23.4 39.2c.4 4 3.1 7.1 6.8 8"
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="b" x1="12" y1="6" x2="52" y2="60" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{bg_hi}"/><stop offset="1" stop-color="{bg_lo}"/></linearGradient><radialGradient id="d" cx="40%" cy="38%" r="70%"><stop offset="0" stop-color="#3a3a40"/><stop offset=".55" stop-color="#121215"/><stop offset="1" stop-color="#050506"/></radialGradient></defs><circle cx="32" cy="32" r="32" fill="url(#b)"/><circle cx="32" cy="32" r="30.6" fill="none" stroke="{ring}" stroke-opacity=".35" stroke-width="1.2"/><path d="{drop}" fill="url(#d)"/><path d="{shine}" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="26.4" cy="27.4" rx="2" ry="3.4" fill="#ffffff" fill-opacity=".55" transform="rotate(30 26.4 27.4)"/></svg>'''
    open(os.path.join(out, f'{name}.svg'), 'w').write(svg)

metal('gold',      '#f7cf55', '#b8790f', '#fff0b3', '#e6a51f', '#fff7d6', '#7d4f05')
metal('silver',    '#c3ccd6', '#6d7885', '#ffffff', '#c3ccd6', '#ffffff', '#4b5560')
metal('platinum',  '#9fb6c9', '#4f6577', '#f3f8fb', '#b8c9d6', '#ffffff', '#3d4f5e')
metal('palladium', '#c4b8a6', '#6f6556', '#f6f1ea', '#cdc3b4', '#ffffff', '#544b3f')
oil('wti',   '#f6b04a', '#c56a12', '#ffe0b0')
oil('brent', '#4f9cc0', '#1d5470', '#bfe6f7')
