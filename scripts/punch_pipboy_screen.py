#!/usr/bin/env python3
"""Punch out the Pip-Boy screen area (make transparent) based on green-screen detection.

Usage:
  python3 scripts/punch_pipboy_screen.py \
      --original public/image.png \
      --cutout public/image-shell-cutout.png \
      -o public/image-shell-hollow.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


def detect_green_bbox(img: Image.Image) -> tuple[int, int, int, int]:
    rgb = img.convert("RGB")
    w, h = rgb.size
    pix = rgb.load()

    min_x, min_y = w, h
    max_x, max_y = -1, -1
    count = 0

    for y in range(h):
        for x in range(w):
            r, g, b = pix[x, y]
            # Pip-Boy CRT green dominance filter.
            if g > 110 and g > r * 1.2 and g > b * 1.15 and (g - r) > 30:
                count += 1
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y

    if count < 100:
        raise SystemExit("Could not detect enough green screen pixels for reliable screen punch.")

    return (min_x, min_y, max_x, max_y)


def punch_screen(
    cutout: Image.Image,
    green_bbox: tuple[int, int, int, int],
    crop_offset: tuple[int, int],
    inset_expand: int,
) -> Image.Image:
    x0, y0, x1, y1 = green_bbox
    off_x, off_y = crop_offset

    # Move from original coordinates to cropped-cutout coordinates.
    x0 -= off_x
    x1 -= off_x
    y0 -= off_y
    y1 -= off_y

    # Expand a bit so black CRT interior is removed, while bezel remains.
    x0 -= inset_expand
    y0 -= inset_expand
    x1 += inset_expand
    y1 += inset_expand

    w, h = cutout.size
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(w - 1, x1)
    y1 = min(h - 1, y1)

    if x1 <= x0 or y1 <= y0:
        raise SystemExit("Invalid punch rectangle computed.")

    rect_w = x1 - x0 + 1
    rect_h = y1 - y0 + 1
    radius = max(14, int(min(rect_w, rect_h) * 0.10))

    rgba = cutout.convert("RGBA")
    alpha = rgba.getchannel("A")

    hole = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(hole)
    draw.rounded_rectangle((x0, y0, x1, y1), radius=radius, fill=255)

    # Soften only hole edge a little for anti-aliased look.
    hole = hole.filter(ImageFilter.GaussianBlur(1.1))

    new_alpha = Image.new("L", (w, h), 0)
    # new alpha = alpha * (1 - hole)
    a_data = alpha.getdata()
    h_data = hole.getdata()
    new_alpha.putdata([max(0, int(a * (255 - h) / 255)) for a, h in zip(a_data, h_data)])

    out = rgba.copy()
    out.putalpha(new_alpha)
    return out


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Punch out Pip-Boy screen area from a cutout PNG")
    p.add_argument("--original", required=True, type=Path, help="Original image (for green detection)")
    p.add_argument("--cutout", required=True, type=Path, help="Foreground cutout PNG")
    p.add_argument("-o", "--output", type=Path, required=True, help="Output hollow-shell PNG")
    p.add_argument(
        "--crop-offset",
        default="24,24",
        help="Offset x,y if cutout was cropped with padding (default: 24,24)",
    )
    p.add_argument(
        "--expand",
        type=int,
        default=14,
        help="Expand amount around green bbox when punching (default: 14)",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()

    if not args.original.exists():
        raise SystemExit(f"Original not found: {args.original}")
    if not args.cutout.exists():
        raise SystemExit(f"Cutout not found: {args.cutout}")

    try:
        off_x_s, off_y_s = args.crop_offset.split(",", 1)
        crop_offset = (int(off_x_s.strip()), int(off_y_s.strip()))
    except Exception as exc:  # noqa: BLE001
        raise SystemExit("--crop-offset must be like '24,24'") from exc

    original = Image.open(args.original)
    cutout = Image.open(args.cutout)

    green_bbox = detect_green_bbox(original)
    out = punch_screen(cutout, green_bbox, crop_offset, args.expand)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    out.save(args.output)

    print(f"Detected green bbox in original: {green_bbox}")
    print(f"Crop offset: {crop_offset}")
    print(f"Wrote: {args.output}")


if __name__ == "__main__":
    main()
