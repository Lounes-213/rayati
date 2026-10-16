#!/usr/bin/env python3
"""Generate a synthetic calibration video + ground truth.

This is the rehearsal rig for Phase 2: instead of standing in a stadium, it renders
what a camera would see — dark stands, a few phones flashing their Gray seat code
with random phase offsets, some static bright spots that must be ignored — and
writes the ground truth next to it. tools/test_calibration_pipeline.py then runs
opencv_calibrate.py on it and checks the corrections.

Usage:
    python tools/make_test_video.py --out tools/assets/out/calib.mp4 --truth tools/assets/out/calib.truth.json
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import cv2
import numpy as np

from opencv_calibrate import BitLayout, build_seat_map, load_seats


def gray(value: int, data_bits: int) -> list[int]:
    g = value ^ (value >> 1)
    return [(g >> i) & 1 for i in range(data_bits - 1, -1, -1)]


def parity(bits: list[int]) -> int:
    result = 0
    for bit in bits:
        result ^= bit
    return result


def projection(grid_w: int, grid_h: int, image_w: int, image_h: int) -> np.ndarray:
    """Grid -> image homography (a stand seen from the pitch, slight perspective)."""
    src = np.float32([[0, 0], [grid_w, 0], [grid_w, grid_h], [0, grid_h]])
    dst = np.float32(
        [
            [image_w * 0.06, image_h * 0.92],
            [image_w * 0.94, image_h * 0.86],
            [image_w * 0.88, image_h * 0.12],
            [image_w * 0.12, image_h * 0.16],
        ]
    )
    return cv2.getPerspectiveTransform(src, dst)


def main() -> None:
    parser = argparse.ArgumentParser(description="Synthetic calibration video generator")
    parser.add_argument("--seats", type=Path, default=Path("public/seats.json"))
    parser.add_argument("--out", type=Path, default=Path("tools/assets/out/calib.mp4"))
    parser.add_argument("--truth", type=Path, default=Path("tools/assets/out/calib.truth.json"))
    parser.add_argument("--phones", type=int, default=12)
    parser.add_argument("--displaced", type=int, default=5)
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument("--fps", type=float, default=30.0)
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--height", type=int, default=1080)
    parser.add_argument("--bit-ms", type=int, default=250)
    parser.add_argument("--gap-ms", type=int, default=5000)
    parser.add_argument("--data-bits", type=int, default=16)
    parser.add_argument("--phone-px", type=int, default=16)
    parser.add_argument("--static-spots", type=int, default=8)
    parser.add_argument("--noise", type=float, default=5.0)
    parser.add_argument("--seed", type=int, default=11)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    seats = load_seats(args.seats)
    layout = seats["layout"]
    grid_w = layout["sectionCols"] * layout["cellW"]
    grid_h = layout["sectionRows"] * layout["cellH"]
    cell_to_seat, order = build_seat_map(seats)
    homography = projection(grid_w, grid_h, args.width, args.height)

    bit_layout = BitLayout(args.data_bits, args.gap_ms, args.bit_ms)
    bit_frames = args.fps * args.bit_ms / 1000.0
    cycle_frames = bit_layout.total_bits * bit_frames

    # Pick phones on a coarse lattice so blobs never overlap in the image.
    # Keep phones away from the image borders (the perspective squeezes them) and
    # far enough apart that two blobs never merge into one connected component.
    min_x, max_x = grid_w * 0.12, grid_w * 0.88
    min_y, max_y = grid_h * 0.15, grid_h * 0.85
    picks: list[tuple[int, int, int]] = []  # (registered seat, gridX, gridY)
    attempts = 0
    while len(picks) < args.phones and attempts < 20000:
        attempts += 1
        seat = rng.randrange(len(order))
        x, y = order[seat]
        if not (min_x <= x <= max_x and min_y <= y <= max_y):
            continue
        if any(abs(x - px) < 4 or abs(y - py) < 2 for _, px, py in picks):
            continue
        picks.append((seat, x, y))
    if len(picks) < args.phones:
        print(f"warning: only {len(picks)} well-spaced phones found in this stadium layout")

    phones = []
    displaced_seats = set(rng.sample(range(len(picks)), min(args.displaced, len(picks))))
    for index, (seat, x, y) in enumerate(picks):
        # A displaced phone is physically at another seat (a few columns away).
        if index in displaced_seats:
            dx = rng.choice([-4, -3, 3, 4])
            dy = rng.choice([-2, -1, 1, 2])
            physical_seat = cell_to_seat.get((x + dx, y + dy))
            while physical_seat is None:
                dx += 1 if dx >= 0 else -1
                physical_seat = cell_to_seat.get((x + dx, y + dy))
            px, py = x + dx, y + dy
        else:
            physical_seat = seat
            px, py = x, y
        point = cv2.perspectiveTransform(np.float32([[[px, py]]]), homography)[0][0]
        bits = [1] + gray(seat, args.data_bits)
        bits.append(parity(bits[1:]))
        phones.append(
            {
                "seat": seat,
                "sourceSeat": int(physical_seat),
                "gridX": float(px),
                "gridY": float(py),
                "imageX": float(point[0]),
                "imageY": float(point[1]),
                "bits": bits,
                "phase": rng.random() * cycle_frames,
            }
        )

    # Static bright spots: they must NOT be flagged as phones.
    statics = []
    for _ in range(args.static_spots):
        statics.append(
            (
                rng.randrange(int(args.width * 0.1), int(args.width * 0.9)),
                rng.randrange(int(args.height * 0.15), int(args.height * 0.9)),
            )
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(args.out), fourcc, args.fps, (args.width, args.height))
    frames = int(args.seconds * args.fps)
    half = args.phone_px // 2

    for frame_index in range(frames):
        frame = np.full((args.height, args.width, 3), 14, dtype=np.uint8)  # dark stands
        for sx, sy in statics:  # constant light: no frame difference
            cv2.rectangle(frame, (sx - 6, sy - 5), (sx + 6, sy + 5), (200, 200, 200), -1)
        for phone in phones:
            position = (frame_index + phone["phase"]) % cycle_frames
            slot = int(position / bit_frames)
            if slot >= bit_layout.n_bits:
                level = 20  # gap between two codes: screen dark
            else:
                level = 245 if phone["bits"][slot] else 22
            cx, cy = int(round(phone["imageX"])), int(round(phone["imageY"]))
            frame[cy - half : cy + half, cx - half : cx + half] = level
        if args.noise > 0:
            noise = np.random.normal(0, args.noise, frame.shape)
            frame = np.clip(frame.astype(np.float32) + noise, 0, 255).astype(np.uint8)
        writer.write(frame)
    writer.release()

    refs = []
    for gx, gy in ((0, 0), (grid_w, 0), (grid_w, grid_h), (0, grid_h)):
        point = cv2.perspectiveTransform(np.float32([[[gx, gy]]]), homography)[0][0]
        refs.append([round(float(point[0]), 2), round(float(point[1]), 2), gx, gy])

    args.truth.write_text(
        json.dumps(
            {
                "video": str(args.out),
                "fps": args.fps,
                "size": [args.width, args.height],
                "refs": refs,
                "phones": [
                    {
                        "seat": p["seat"],
                        "sourceSeat": p["sourceSeat"],
                        "gridX": p["gridX"],
                        "gridY": p["gridY"],
                    }
                    for p in phones
                ],
                "statics": statics,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(
        f"{args.out}: {frames} frames · {len(phones)} phones "
        f"({len(displaced_seats)} displaced) · {len(statics)} static spots · truth -> {args.truth}"
    )
    print(f"  code: start bit + {args.data_bits} gray bits + parity · {args.bit_ms} ms/bit · {bit_frames:.1f} frames/bit")


if __name__ == "__main__":
    main()
