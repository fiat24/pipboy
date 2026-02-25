#!/usr/bin/env python3
"""Extract a Pip-Boy device cutout from a photo with mostly uniform background.

Usage:
  python3 scripts/extract_pipboy_shell.py input.png -o output.png
"""

from __future__ import annotations

import argparse
import math
from collections import Counter, deque
from pathlib import Path

from PIL import Image, ImageFilter


def quantize_color(rgb: tuple[int, int, int], step: int = 8) -> tuple[int, int, int]:
    return tuple((c // step) * step for c in rgb)


def color_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    dr = a[0] - b[0]
    dg = a[1] - b[1]
    db = a[2] - b[2]
    return math.sqrt(dr * dr + dg * dg + db * db)


def estimate_background_color(pixels: list[tuple[int, int, int]], w: int, h: int) -> tuple[int, int, int]:
    border = []
    for x in range(w):
        border.append(pixels[x])
        border.append(pixels[(h - 1) * w + x])
    for y in range(h):
        border.append(pixels[y * w])
        border.append(pixels[y * w + (w - 1)])

    buckets = Counter(quantize_color(px) for px in border)
    dominant_bucket, _ = buckets.most_common(1)[0]

    matched = [px for px in border if quantize_color(px) == dominant_bucket]
    if not matched:
        return dominant_bucket

    r = sum(px[0] for px in matched) // len(matched)
    g = sum(px[1] for px in matched) // len(matched)
    b = sum(px[2] for px in matched) // len(matched)
    return (r, g, b)


def estimate_tolerance(
    pixels: list[tuple[int, int, int]], w: int, h: int, bg: tuple[int, int, int]
) -> int:
    border = []
    for x in range(w):
        border.append(pixels[x])
        border.append(pixels[(h - 1) * w + x])
    for y in range(h):
        border.append(pixels[y * w])
        border.append(pixels[y * w + (w - 1)])

    distances = sorted(color_distance(px, bg) for px in border)
    if not distances:
        return 28

    p90 = distances[int(0.9 * (len(distances) - 1))]
    tol = int(max(16, min(62, p90 + 8)))
    return tol


def flood_background(
    pixels: list[tuple[int, int, int]],
    w: int,
    h: int,
    bg_color: tuple[int, int, int],
    tolerance: int,
) -> bytearray:
    size = w * h
    bg_mask = bytearray(size)
    q: deque[int] = deque()

    def try_seed(idx: int) -> None:
        if bg_mask[idx]:
            return
        if color_distance(pixels[idx], bg_color) <= tolerance:
            bg_mask[idx] = 1
            q.append(idx)

    for x in range(w):
        try_seed(x)
        try_seed((h - 1) * w + x)
    for y in range(h):
        try_seed(y * w)
        try_seed(y * w + (w - 1))

    while q:
        idx = q.popleft()
        x = idx % w
        y = idx // w

        # 4-neighborhood keeps edges tighter.
        if x > 0:
            n = idx - 1
            if not bg_mask[n] and color_distance(pixels[n], bg_color) <= tolerance:
                bg_mask[n] = 1
                q.append(n)
        if x + 1 < w:
            n = idx + 1
            if not bg_mask[n] and color_distance(pixels[n], bg_color) <= tolerance:
                bg_mask[n] = 1
                q.append(n)
        if y > 0:
            n = idx - w
            if not bg_mask[n] and color_distance(pixels[n], bg_color) <= tolerance:
                bg_mask[n] = 1
                q.append(n)
        if y + 1 < h:
            n = idx + w
            if not bg_mask[n] and color_distance(pixels[n], bg_color) <= tolerance:
                bg_mask[n] = 1
                q.append(n)

    return bg_mask


def find_largest_component(object_mask: bytearray, w: int, h: int) -> bytearray:
    size = w * h
    visited = bytearray(size)
    q: deque[int] = deque()

    best_seed = -1
    best_count = 0

    for i in range(size):
        if not object_mask[i] or visited[i]:
            continue

        visited[i] = 1
        q.append(i)
        count = 0
        seed = i

        while q:
            idx = q.popleft()
            count += 1

            x = idx % w
            y = idx // w

            if x > 0:
                n = idx - 1
                if object_mask[n] and not visited[n]:
                    visited[n] = 1
                    q.append(n)
            if x + 1 < w:
                n = idx + 1
                if object_mask[n] and not visited[n]:
                    visited[n] = 1
                    q.append(n)
            if y > 0:
                n = idx - w
                if object_mask[n] and not visited[n]:
                    visited[n] = 1
                    q.append(n)
            if y + 1 < h:
                n = idx + w
                if object_mask[n] and not visited[n]:
                    visited[n] = 1
                    q.append(n)

        if count > best_count:
            best_count = count
            best_seed = seed

    keep = bytearray(size)
    if best_seed < 0:
        return keep

    q.append(best_seed)
    keep[best_seed] = 1

    while q:
        idx = q.popleft()
        x = idx % w
        y = idx // w

        if x > 0:
            n = idx - 1
            if object_mask[n] and not keep[n]:
                keep[n] = 1
                q.append(n)
        if x + 1 < w:
            n = idx + 1
            if object_mask[n] and not keep[n]:
                keep[n] = 1
                q.append(n)
        if y > 0:
            n = idx - w
            if object_mask[n] and not keep[n]:
                keep[n] = 1
                q.append(n)
        if y + 1 < h:
            n = idx + w
            if object_mask[n] and not keep[n]:
                keep[n] = 1
                q.append(n)

    return keep


def build_alpha_mask(component_mask: bytearray, w: int, h: int) -> Image.Image:
    alpha = Image.new("L", (w, h), 0)
    alpha.putdata([255 if component_mask[i] else 0 for i in range(w * h)])

    # Slight close/open + blur for cleaner edges without over-softening.
    alpha = alpha.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))

    # Keep a crisp-ish edge after blur.
    alpha = alpha.point(lambda v: 255 if v > 96 else 0)
    return alpha


def crop_to_alpha(img: Image.Image, alpha: Image.Image, padding: int = 24) -> Image.Image:
    bbox = alpha.getbbox()
    if not bbox:
        return img

    l, t, r, b = bbox
    l = max(0, l - padding)
    t = max(0, t - padding)
    r = min(img.width, r + padding)
    b = min(img.height, b + padding)
    return img.crop((l, t, r, b))


def run(input_path: Path, output_path: Path, crop: bool, padding: int, debug_mask: bool) -> None:
    src = Image.open(input_path).convert("RGBA")
    w, h = src.size
    rgb_pixels = list(src.convert("RGB").getdata())

    bg_color = estimate_background_color(rgb_pixels, w, h)
    tolerance = estimate_tolerance(rgb_pixels, w, h, bg_color)

    bg_mask = flood_background(rgb_pixels, w, h, bg_color, tolerance)
    object_mask = bytearray(0 if bg_mask[i] else 1 for i in range(w * h))

    largest_component = find_largest_component(object_mask, w, h)
    alpha = build_alpha_mask(largest_component, w, h)

    out = src.copy()
    out.putalpha(alpha)

    if crop:
        out = crop_to_alpha(out, alpha, padding=padding)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(output_path)

    if debug_mask:
        mask_path = output_path.with_name(output_path.stem + "-mask.png")
        alpha.save(mask_path)

    kept = sum(1 for v in largest_component if v)
    print(f"Input: {input_path}")
    print(f"Output: {output_path}")
    print(f"Size: {w}x{h}")
    print(f"Estimated background color: {bg_color}")
    print(f"Tolerance: {tolerance}")
    print(f"Kept pixels: {kept}")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Extract Pip-Boy shell/device into a transparent PNG")
    p.add_argument("input", type=Path, help="Input image path")
    p.add_argument("-o", "--output", type=Path, default=None, help="Output PNG path")
    p.add_argument("--no-crop", action="store_true", help="Keep original canvas size")
    p.add_argument("--padding", type=int, default=24, help="Crop padding in pixels")
    p.add_argument("--debug-mask", action="store_true", help="Also write alpha mask PNG")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    input_path: Path = args.input
    if not input_path.exists():
        raise SystemExit(f"Input not found: {input_path}")

    output_path: Path
    if args.output is None:
        output_path = input_path.with_name(input_path.stem + "-shell.png")
    else:
        output_path = args.output

    run(
        input_path=input_path,
        output_path=output_path,
        crop=not args.no_crop,
        padding=args.padding,
        debug_mask=args.debug_mask,
    )


if __name__ == "__main__":
    main()
