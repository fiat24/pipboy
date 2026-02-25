#!/usr/bin/env python3
"""Remove the center stand/base from a cropped Pip-Boy cutout PNG.

This is a practical silhouette filter tuned for front-view Pip-Boy photos where the
stand is centered below the main body.

Usage:
  python3 scripts/remove_pipboy_stand.py \
      --input public/image-shell-cutout.png \
      --output public/image-shell-nostand.png
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter


def build_keep_mask(alpha: Image.Image) -> Image.Image:
    w, h = alpha.size
    ap = alpha.load()

    keep = Image.new("L", (w, h), 0)
    kp = keep.load()

    # Keep rules:
    # - upper body
    # - left wrist-side lower shell
    # - right wrist-side lower shell
    # - slight lower-left belly to avoid over-trimming
    for y in range(h):
        for x in range(w):
            if ap[x, y] == 0:
                continue

            cond = False
            if y <= 642:
                cond = True
            if x <= 210 and y <= 730:
                cond = True
            if x >= 720 and y <= 730:
                cond = True
            if 170 <= x <= 280 and y <= 675:
                cond = True

            if cond:
                kp[x, y] = 255

    return keep


def keep_large_components(mask: Image.Image, min_area: int = 400) -> Image.Image:
    w, h = mask.size
    data = [1 if v > 0 else 0 for v in mask.getdata()]
    visited = [0] * (w * h)

    comps: list[list[int]] = []

    for i, v in enumerate(data):
        if not v or visited[i]:
            continue

        q: deque[int] = deque([i])
        visited[i] = 1
        comp = [i]

        while q:
            u = q.popleft()
            x = u % w
            y = u // w

            if x > 0:
                n = u - 1
                if data[n] and not visited[n]:
                    visited[n] = 1
                    q.append(n)
                    comp.append(n)
            if x + 1 < w:
                n = u + 1
                if data[n] and not visited[n]:
                    visited[n] = 1
                    q.append(n)
                    comp.append(n)
            if y > 0:
                n = u - w
                if data[n] and not visited[n]:
                    visited[n] = 1
                    q.append(n)
                    comp.append(n)
            if y + 1 < h:
                n = u + w
                if data[n] and not visited[n]:
                    visited[n] = 1
                    q.append(n)
                    comp.append(n)

        comps.append(comp)

    out = Image.new("L", (w, h), 0)
    out_data = [0] * (w * h)

    for comp in comps:
        if len(comp) < min_area:
            continue
        for i in comp:
            out_data[i] = 255

    out.putdata(out_data)
    return out


def run(input_path: Path, output_path: Path) -> None:
    src = Image.open(input_path).convert("RGBA")
    alpha = src.getchannel("A")

    keep = build_keep_mask(alpha)
    keep = keep_large_components(keep, min_area=400)

    # Subtle anti-aliasing around trimmed edges.
    keep = keep.filter(ImageFilter.GaussianBlur(0.8)).point(lambda v: 255 if v > 90 else 0)

    out = src.copy()
    out.putalpha(keep)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(output_path)

    bbox = keep.getbbox()
    print(f"Input: {input_path}")
    print(f"Output: {output_path}")
    print(f"Mask bbox: {bbox}")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Remove Pip-Boy center stand from cutout PNG")
    p.add_argument("--input", required=True, type=Path, help="Input cutout PNG (with alpha)")
    p.add_argument("--output", required=True, type=Path, help="Output no-stand PNG")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    if not args.input.exists():
        raise SystemExit(f"Input not found: {args.input}")

    run(args.input, args.output)


if __name__ == "__main__":
    main()
