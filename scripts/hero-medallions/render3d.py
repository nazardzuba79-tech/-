"""Small numpy SDF renderer for the VOLTEX hero assets.

Coins: a thick bevelled medallion with a raised metallic rim, a groove, a
face material and relief decals (logo + ticker) under one studio
environment. Platform: a three-tier graphite/gold pedestal with an
emissive top, a glow and a floor reflection. Output: straight RGBA PNG.
"""
import json
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

PI = math.pi


def norm(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def dot(a, b):
    return np.sum(a * b, axis=-1)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


# ---------------------------------------------------------------- SDF
def sd_rcyl(p, r, h, rb, axis=2):
    ax = [0, 1, 2]
    ax.remove(axis)
    q0 = np.hypot(p[:, ax[0]], p[:, ax[1]]) - r + rb
    q1 = np.abs(p[:, axis]) - h + rb
    return np.minimum(np.maximum(q0, q1), 0) + np.hypot(np.maximum(q0, 0), np.maximum(q1, 0)) - rb


def sd_torus(p, R, r, c, axis=2):
    ax = [0, 1, 2]
    ax.remove(axis)
    return np.hypot(np.hypot(p[:, ax[0]], p[:, ax[1]]) - R, p[:, axis] - c) - r


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return lerp(b, a, h) - k * h * (1 - h)


def march(ro, rd, sdf, tmax, steps=180, eps=2.5e-4):
    n = ro.shape[0]
    t = np.zeros(n)
    hit = np.zeros(n, bool)
    active = np.ones(n, bool)
    for _ in range(steps):
        idx = np.nonzero(active)[0]
        if idx.size == 0:
            break
        p = ro[idx] + rd[idx] * t[idx, None]
        d = sdf(p)
        h = d < eps
        hit[idx[h]] = True
        tn = t[idx] + np.maximum(d, eps * 0.5) * 0.92
        t[idx] = tn
        done = h | (tn > tmax)
        active[idx[done]] = False
    return t, hit


def normal(p, sdf, e=6e-4):
    k = np.array([[1, -1, -1], [-1, -1, 1], [-1, 1, -1], [1, 1, 1]], float) * e
    n = np.zeros_like(p)
    for i in range(4):
        n += k[i] * sdf(p + k[i])[:, None]
    return norm(n)


def ambient_occlusion(p, n, sdf):
    occ = np.zeros(p.shape[0])
    sca = 1.0
    for i in range(1, 6):
        h = 0.012 + 0.05 * i
        d = sdf(p + n * h)
        occ += (h - d) * sca
        sca *= 0.72
    return np.clip(1 - 2.2 * occ, 0, 1)


# ------------------------------------------------------------ lighting
LIGHTS = [
    (norm(np.array([-0.55, 0.78, 0.62])), np.array([1.0, 0.97, 0.90]) * 3.2),   # key, upper left front
    (norm(np.array([0.05, -0.85, 0.55])), np.array([1.0, 0.72, 0.34]) * 1.15),  # platform glow from below
    (norm(np.array([0.80, 0.18, 0.55])), np.array([0.50, 0.68, 1.0]) * 0.75),   # cool fill, right
]
ENV_AVG = np.array([0.11, 0.13, 0.19])


def lobe(d, L, w):
    return np.exp(-(1 - dot(d, L)) / w)[:, None]


def env(d):
    up = d[:, 1:2]
    sky = lerp(np.array([0.08, 0.11, 0.20]), np.array([0.34, 0.38, 0.48]), smoothstep(0.05, 0.9, up))
    ground = lerp(np.array([0.016, 0.02, 0.05]), np.array([0.16, 0.10, 0.045]), smoothstep(-0.1, -0.9, up))
    base = np.where(up > 0, sky, ground)
    base = base * (1 - 0.8 * np.exp(-(up / 0.08) ** 2))  # dark horizon band
    key = LIGHTS[0][0]
    c = base
    c = c + lobe(d, key, 0.045) * np.array([1.0, 0.98, 0.93]) * 4.5
    c = c + lobe(d, key, 0.35) * np.array([1.0, 0.98, 0.95]) * 0.5
    c = c + lobe(d, norm(np.array([0.0, -1.0, 0.35])), 0.30) * np.array([1.0, 0.70, 0.32]) * 0.75
    c = c + lobe(d, norm(np.array([0.85, 0.15, 0.15])), 0.22) * np.array([0.32, 0.55, 1.0]) * 0.55
    c = c + lobe(d, norm(np.array([-0.2, 0.3, -1.0])), 0.25) * np.array([0.9, 0.95, 1.0]) * 0.25
    return c


def shade(N, V, albedo, metal, rough, emissive, ao):
    metal = metal[:, None]
    rough = np.clip(rough, 0.05, 1)[:, None]
    F0 = lerp(np.full_like(albedo, 0.04), albedo, metal)
    NdV = np.clip(dot(N, V), 1e-3, 1)[:, None]
    col = np.zeros_like(albedo)
    for L, rad in LIGHTS:
        NdL = np.clip(dot(N, L), 0, 1)[:, None]
        H = norm(L + V)
        NdH = np.clip(dot(N, H), 0, 1)[:, None]
        VdH = np.clip(dot(V, H), 0, 1)[:, None]
        a2 = (rough * rough) ** 2
        D = a2 / (PI * ((NdH * NdH * (a2 - 1) + 1) ** 2))
        k = (rough + 1) ** 2 / 8
        G = (NdV / (NdV * (1 - k) + k)) * (NdL / (NdL * (1 - k) + k))
        F = F0 + (1 - F0) * (1 - VdH) ** 5
        spec = D * G * F / (4 * NdV * NdL + 1e-4)
        kd = (1 - F) * (1 - metal)
        col += (kd * albedo / PI + spec) * rad * NdL
    R = norm(-V + 2 * NdV * N)
    Fr = F0 + (np.maximum(1 - rough, F0) - F0) * (1 - NdV) ** 5
    envc = lerp(env(R), ENV_AVG, rough * 0.85)
    col += envc * Fr * ao[:, None] * (1 - 0.25 * rough)
    col += ENV_AVG * albedo * (1 - metal) * ao[:, None] * 0.9
    col += emissive
    return col


def tonemap(c, exposure=1.0):
    x = np.maximum(c * exposure, 0)
    y = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)
    return np.clip(y, 0, 1) ** (1 / 2.2)


# --------------------------------------------------------- decal canvas
def load_decal(spec, res):
    """Build face-space decal layers on a res x res canvas covering [-1,1]^2.
    Returns dict with mask (res,res), albedo (res,res,3), metal, rough, height."""
    canvas_mask = np.zeros((res, res))
    albedo = np.zeros((res, res, 3))
    metal = np.zeros((res, res))
    rough = np.full((res, res), 0.3)
    layers = []
    if spec.get('logo'):
        layers.append(('logo', spec['logo']))
    if spec.get('label'):
        layers.append(('label', spec['label']))
    for kind, layer in layers:
        if kind == 'logo':
            img = Image.open(layer['png']).convert('RGBA')
            a = np.array(img)[..., 3]
            ys, xs = np.nonzero(a > 8)
            img = img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
            cx, cy, bw, bh = layer['box']  # object units, y up
            sw, sh = img.size
            s = min(bw * res / 2 / sw, bh * res / 2 / sh)
            tw, th = max(1, int(sw * s)), max(1, int(sh * s))
            img = img.resize((tw, th), Image.LANCZOS)
            px = int(round((cx + 1) * res / 2 - tw / 2))
            py = int(round((1 - cy) * res / 2 - th / 2))
            tile = Image.new('RGBA', (res, res), (0, 0, 0, 0))
            tile.paste(img, (px, py), img)
            arr = np.array(tile).astype(float) / 255
            m = arr[..., 3]
            rgb = arr[..., :3]
        else:
            tile = Image.new('L', (res, res), 0)
            draw = ImageDraw.Draw(tile)
            size = int(layer['size'] * res / 2)
            font = ImageFont.truetype(layer['font'], size)
            text = layer['text']
            tracking = int(size * layer.get('tracking', 0.05))
            widths = [draw.textlength(ch, font=font) for ch in text]
            total = sum(widths) + tracking * (len(text) - 1)
            x = (layer.get('x', 0) + 1) * res / 2 - total / 2
            bbox = font.getbbox('H')
            cap = bbox[3] - bbox[1]
            y = (1 - layer['y']) * res / 2 - cap / 2 - bbox[1]
            for ch, w in zip(text, widths):
                draw.text((x, y), ch, font=font, fill=255)
                x += w + tracking
            m = np.array(tile).astype(float) / 255
            rgb = np.zeros((res, res, 3))
        mode = layer['mode']
        if mode == 'gold':
            lrgb = np.broadcast_to(np.array([1.0, 0.655, 0.215]), rgb.shape)
            lmetal, lrough = 1.0, 0.17
        elif mode == 'graphite':
            lrgb = np.broadcast_to(np.array([0.045, 0.05, 0.06]), rgb.shape)
            lmetal, lrough = 0.5, 0.3
        elif mode == 'white':
            lrgb = np.broadcast_to(np.array([0.92, 0.93, 0.95]), rgb.shape)
            lmetal, lrough = 0.1, 0.3
        elif mode == 'raster':
            lrgb = srgb_to_linear(rgb)
            lmetal, lrough = layer.get('metal', 0.0), layer.get('rough', 0.3)
        elif mode == 'raster-metal':
            lrgb = srgb_to_linear(rgb)
            lmetal, lrough = 1.0, 0.28
        elif mode == 'gradient':
            yy, xx = np.mgrid[0:res, 0:res] / res
            t = np.clip((xx + yy) / 2, 0, 1)[..., None]
            c0, c1 = np.array(layer['from']), np.array(layer['to'])
            lrgb = srgb_to_linear(lerp(c0, c1, t))
            lmetal, lrough = 0.0, 0.25
        else:
            raise ValueError(mode)
        m3 = m[..., None]
        albedo = lerp(albedo, lrgb, m3)
        metal = lerp(metal, lmetal, m)
        rough = lerp(rough, lrough, m)
        canvas_mask = np.maximum(canvas_mask, m)
    blur = spec.get('relief_blur', 2.2) * res / 1024
    height = np.array(Image.fromarray((canvas_mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(blur))).astype(float) / 255
    # Contact shadow of the relief, cast down-right (key light is upper left).
    sh = Image.fromarray((canvas_mask * 255).astype(np.uint8))
    off = int(spec.get('relief_shadow', 7) * res / 1024)
    shadow = Image.new('L', (res, res), 0)
    shadow.paste(sh, (off, off))
    shadow = np.array(shadow.filter(ImageFilter.GaussianBlur(off * 0.9))).astype(float) / 255
    shadow = shadow * (1 - canvas_mask)
    gy, gx = np.gradient(height)
    return dict(mask=canvas_mask, albedo=albedo, metal=metal, rough=rough, height=height, gx=gx * res, gy=gy * res, shadow=shadow)


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def sample(arr, u, v):
    """Bilinear sample of arr (res,res[,c]) at u,v in [0,1] (v down)."""
    res = arr.shape[0]
    x = np.clip(u * (res - 1), 0, res - 1.001)
    y = np.clip(v * (res - 1), 0, res - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    if arr.ndim == 3:
        fx, fy = fx[:, None], fy[:, None]
    a = arr[y0, x0] * (1 - fx) + arr[y0, x0 + 1] * fx
    b = arr[y0 + 1, x0] * (1 - fx) + arr[y0 + 1, x0 + 1] * fx
    return a * (1 - fy) + b * fy


# ----------------------------------------------------------------- coin
T = 0.11


RECESS = 0.035
FACE_R = 0.835


def coin_sdf(p):
    # Thick disc with a rounded outer bevel, a flat polished bezel and a
    # recessed face behind a small filleted step.
    body = sd_rcyl(p, 1.0, T, 0.04)
    recess = sd_rcyl(p - np.array([0, 0, T - RECESS + 0.5]), FACE_R, 0.5, 0.014)
    d = np.maximum(body, -recess)
    groove = sd_torus(p, 0.945, 0.012, T + 0.004)
    return np.maximum(d, -groove)


FACE_MATERIALS = {
    'graphite': (np.array([0.030, 0.034, 0.042]), 0.75, 0.24),
    'white': (np.array([0.86, 0.875, 0.905]), 0.32, 0.22),
    'silver': (np.array([0.86, 0.87, 0.90]), 0.85, 0.34),
}
RIM_GOLD = (np.array([1.0, 0.655, 0.215]), 1.0, 0.14)


def render_coin(spec, out):
    size = spec.get('size', 640)
    ss = spec.get('ss', 2)
    W = size * ss
    extent = spec.get('extent', 1.32)
    cz = spec.get('camera_z', 7.5)
    ax, ay = [math.radians(a) for a in spec.get('tilt', [-8, -18])]
    rot = rot_x(ax) @ rot_y(ay)
    rot_t = rot.T
    decal = load_decal(spec, spec.get('decal_res', 1024))

    ys, xs = np.mgrid[0:W, 0:W]
    u = (xs + 0.5) / W * 2 - 1
    v = 1 - (ys + 0.5) / W * 2
    u, v = u.ravel(), v.ravel()
    # Ray in world space: camera at (0,0,cz) looking down -Z.
    rd_w = norm(np.stack([u * extent, v * extent, np.full_like(u, -cz)], -1))
    ro_w = np.array([0.0, 0.0, cz])
    ro = (rot_t @ ro_w)[None, :].repeat(rd_w.shape[0], 0)
    rd = rd_w @ rot  # rot_t @ rd for each row
    candidate = np.hypot(u, v) < 1.22
    cidx = np.nonzero(candidate)[0]
    t, hit = march(ro[cidx], rd[cidx], coin_sdf, tmax=cz + 2.5)
    hidx = cidx[hit]
    P = ro[hidx] + rd[hidx] * t[hit][:, None]
    N = normal(P, coin_sdf)
    ao = ambient_occlusion(P, N, coin_sdf)
    r = np.hypot(P[:, 0], P[:, 1])
    face = (P[:, 2] < T - RECESS + 0.006) & (r < FACE_R - 0.004)
    n = P.shape[0]
    albedo = np.tile(RIM_GOLD[0], (n, 1))
    metal = np.full(n, RIM_GOLD[1])
    rough = np.full(n, RIM_GOLD[2])
    emissive = np.zeros((n, 3))
    fm = FACE_MATERIALS[spec.get('face', 'white')]
    albedo[face] = fm[0]
    metal[face] = fm[1]
    rough[face] = fm[2]
    # Decals on the face.
    fi = np.nonzero(face)[0]
    uu = (P[fi, 0] + 1) / 2
    vv = (1 - P[fi, 1]) / 2
    m = sample(decal['mask'], uu, vv)
    albedo[fi] = lerp(albedo[fi], sample(decal['albedo'], uu, vv), m[:, None])
    metal[fi] = lerp(metal[fi], sample(decal['metal'], uu, vv), m)
    rough[fi] = lerp(rough[fi], sample(decal['rough'], uu, vv), m)
    shadow = sample(decal['shadow'], uu, vv)
    albedo[fi] *= (1 - spec.get('relief_shadow_strength', 0.5) * shadow)[:, None]
    gx = sample(decal['gx'], uu, vv)
    gy = sample(decal['gy'], uu, vv)
    amp = spec.get('relief_amp', 0.022)
    # Height gradient in face space (u right, v down -> object y up).
    Nf = N[fi].copy()
    Nf[:, 0] -= gx * amp
    Nf[:, 1] += gy * amp
    N[fi] = norm(Nf)
    ao[fi] *= 1 - 0.35 * shadow
    # Shade in world space.
    Nw = N @ rot_t  # rot @ n
    Pw = P @ rot_t
    V = norm(ro_w[None, :] - Pw)
    col = shade(Nw, V, albedo, metal, rough, emissive, ao)
    col = tonemap(col, spec.get('exposure', 1.0))
    img = np.zeros((W * W, 4))
    img[hidx, :3] = col
    img[hidx, 3] = 1
    img = img.reshape(W, W, 4)
    # Downsample premultiplied.
    pre = img.copy()
    pre[..., :3] *= pre[..., 3:4]
    pre = pre.reshape(size, ss, size, ss, 4).mean(axis=(1, 3))
    a = pre[..., 3:4]
    rgb = np.where(a > 1e-4, pre[..., :3] / np.maximum(a, 1e-4), 0)
    out_img = np.concatenate([rgb, a], -1)
    # Baked soft shadow under the coin.
    if spec.get('shadow', True):
        coin_px = size / extent
        alpha = Image.fromarray((a[..., 0] * 255).astype(np.uint8))
        sh = Image.new('L', (size, size), 0)
        sh.paste(alpha, (int(coin_px * 0.03), int(coin_px * 0.11)))
        sh = np.array(sh.filter(ImageFilter.GaussianBlur(coin_px * 0.045))).astype(float) / 255 * spec.get('shadow_alpha', 0.42)
        sa = sh * (1 - a[..., 0])
        total = a[..., 0] + sa
        rgb2 = np.where(total[..., None] > 1e-4, (rgb * a) / np.maximum(total[..., None], 1e-4), 0)
        out_img = np.concatenate([rgb2, total[..., None]], -1)
    Image.fromarray((np.clip(out_img, 0, 1) * 255).round().astype(np.uint8), 'RGBA').save(out)
    return out


# ------------------------------------------------------------- platform
def platform_sdf(p):
    # Y up, floor at y = 0. Tiers are rounded cylinders along Y.
    base = sd_rcyl(p - np.array([0, 0.075, 0]), 1.0, 0.075, 0.03, axis=1)
    mid = sd_rcyl(p - np.array([0, 0.15 + 0.125, 0]), 0.78, 0.125, 0.03, axis=1)
    top = sd_rcyl(p - np.array([0, 0.40 + 0.05, 0]), 0.60, 0.05, 0.025, axis=1)
    d = smin(base, mid, 0.02)
    d = smin(d, top, 0.02)
    return d


def platform_material(P):
    n = P.shape[0]
    r = np.hypot(P[:, 0], P[:, 2])
    y = P[:, 1]
    albedo = np.tile(np.array([0.028, 0.028, 0.034]), (n, 1))
    metal = np.full(n, 0.7)
    rough = np.full(n, 0.26)
    emissive = np.zeros((n, 3))
    gold = np.array([1.0, 0.73, 0.29])
    # Gold bands on the top edge of each tier, and a gold inlay ring on the top face.
    bands = [(1.0, 0.15), (0.78, 0.40), (0.60, 0.50)]
    for rad, ytop in bands:
        band = (np.abs(y - ytop) < 0.022) & (r > rad - 0.06)
        band |= (np.abs(r - rad) < 0.02) & (y > ytop - 0.05) & (y < ytop + 0.01)
        albedo[band] = gold
        metal[band] = 1.0
        rough[band] = 0.22
    topface = (y > 0.49) & (r < 0.60)
    # Emissive light disc: bright gold ring + softer inner glow, concentric lines.
    ring = np.exp(-((r - 0.52) / 0.035) ** 2)
    ring2 = np.exp(-((r - 0.36) / 0.02) ** 2) * 0.5
    inner = np.clip(1 - r / 0.50, 0, 1) ** 2.2 * 0.9
    lines = 0.5 + 0.5 * np.cos(r * 2 * PI / 0.05)
    e = (ring * 1.7 + ring2 + inner * (0.45 + 0.25 * lines * (r > 0.06))) * topface
    emissive += e[:, None] * np.array([1.0, 0.74, 0.30])
    albedo[topface] = np.array([0.45, 0.30, 0.10])
    metal[topface] = 0.8
    rough[topface] = 0.3
    return albedo, metal, rough, emissive


def render_platform(spec, out):
    Wd, Hd = spec.get('width', 1400), spec.get('height', 820)
    ss = spec.get('ss', 2)
    W, H = Wd * ss, Hd * ss
    cam = np.array(spec.get('camera', [0.0, 1.55, 6.2]))
    target = np.array(spec.get('target', [0.0, 0.22, 0.0]))
    fov = math.radians(spec.get('fov', 26))
    fwd = norm(target - cam)
    right = norm(np.cross(fwd, np.array([0, 1, 0])))
    upv = np.cross(right, fwd)
    ys, xs = np.mgrid[0:H, 0:W]
    u = ((xs + 0.5) / W * 2 - 1) * (W / H)
    v = 1 - (ys + 0.5) / H * 2
    u, v = u.ravel(), v.ravel()
    f = 1 / math.tan(fov / 2)
    rd = norm(u[:, None] * right + v[:, None] * upv + f * fwd)
    ro = cam[None, :].repeat(rd.shape[0], 0)
    t, hit = march(ro, rd, platform_sdf, tmax=12)
    n = rd.shape[0]
    col = np.zeros((n, 3))
    alpha = np.zeros(n)
    emis = np.zeros((n, 3))
    hidx = np.nonzero(hit)[0]
    P = ro[hidx] + rd[hidx] * t[hit][:, None]
    N = normal(P, platform_sdf)
    ao = ambient_occlusion(P, N, platform_sdf)
    albedo, metal, rough, emissive = platform_material(P)
    V = norm(cam[None, :] - P)
    c = shade(N, V, albedo, metal, rough, emissive, ao)
    col[hidx] = c
    alpha[hidx] = 1
    emis[hidx] = emissive
    # Floor reflection: rays that miss hit the floor y=0; mirror and march again.
    miss = ~hit
    floor_t = -ro[:, 1] / np.where(rd[:, 1] < -1e-6, rd[:, 1], -1e-6)
    floor_ok = miss & (rd[:, 1] < -1e-6) & (floor_t > 0)
    fidx = np.nonzero(floor_ok)[0]
    Pf = ro[fidx] + rd[fidx] * floor_t[fidx][:, None]
    rdm = rd[fidx].copy()
    rdm[:, 1] *= -1
    t2, hit2 = march(Pf + np.array([0, 1e-3, 0]), rdm, platform_sdf, tmax=12)
    h2 = np.nonzero(hit2)[0]
    P2 = Pf[h2] + rdm[h2] * t2[hit2][:, None]
    N2 = normal(P2, platform_sdf)
    ao2 = ambient_occlusion(P2, N2, platform_sdf)
    a2, m2, r2, e2 = platform_material(P2)
    V2 = norm(-rdm[h2])
    c2 = shade(N2, V2, a2, m2, r2, e2, ao2)
    # Floor: dark glossy, reflection strength by Fresnel and distance blur/fade.
    cosf = np.clip(-rd[fidx[h2], 1], 0, 1)
    fres = 0.06 + 0.94 * (1 - cosf) ** 4
    dist = np.hypot(Pf[h2, 0], Pf[h2, 2])
    fade = np.clip(1 - (dist - 0.6) / 1.4, 0, 1) * np.clip(1 - t2[hit2] / 1.6, 0.15, 1)
    strength = np.clip(fres * 2.4, 0, 0.8) * fade
    col[fidx[h2]] = c2 * strength[:, None]
    alpha[fidx[h2]] = np.clip(strength * 0.95 + 0.05, 0, 1)
    emis[fidx[h2]] = e2 * strength[:, None] * 0.8
    img = np.zeros((n, 4))
    pre_rgb = tonemap(col, spec.get('exposure', 1.0))
    # Glow: blur of the emissive contribution, added with alpha.
    glow = emis.reshape(H, W, 3)
    glow_img = Image.fromarray((np.clip(tonemap(glow * 0.9), 0, 1) * 255).astype(np.uint8))
    glow_small = glow_img.resize((W // 4, H // 4), Image.BOX).filter(ImageFilter.GaussianBlur(spec.get('glow_blur', 26) * ss / 4)).resize((W, H), Image.BILINEAR)
    glow_arr = np.array(glow_small).astype(float) / 255 * spec.get('glow_gain', 1.3)
    glow_a = np.clip(glow_arr.max(axis=-1), 0, 1)
    img[:, :3] = pre_rgb * alpha[:, None]
    img[:, 3] = alpha
    img = img.reshape(H, W, 4)
    # Composite glow additively (premultiplied add, alpha union).
    g = np.clip(glow_arr, 0, 1).reshape(H, W, 3)
    img[..., :3] = np.clip(img[..., :3] + g * (1 - img[..., 3:4] * 0.55), 0, 1)
    img[..., 3] = np.clip(img[..., 3] + glow_a * (1 - img[..., 3]), 0, 1)
    pre = img.reshape(Hd, ss, Wd, ss, 4).mean(axis=(1, 3))
    a = pre[..., 3:4]
    rgb = np.where(a > 1e-4, pre[..., :3] / np.maximum(a, 1e-4), 0)
    out_img = np.concatenate([np.clip(rgb, 0, 1), a], -1)
    Image.fromarray((out_img * 255).round().astype(np.uint8), 'RGBA').save(out)
    return out


if __name__ == '__main__':
    spec = json.load(open(sys.argv[1]))
    kind = spec.get('kind', 'coin')
    path = render_coin(spec, sys.argv[2]) if kind == 'coin' else render_platform(spec, sys.argv[2])
    print(path)
