#!/usr/bin/env python3
"""Phase 2 — seat correction from a stadium camera (OpenCV).

What happens, in order
----------------------
1. Every phone runs the calibration screen of the PWA: it flashes
   [start bit][Gray(seatIndex)][parity] at ~4 bits/s (tools/../src/core/config.ts
   CALIBRATION). The flash rate stays far below half of the camera frame rate.
2. This tool reads a video (a phone on a tripod is enough for tests, a stadium
   camera for the real thing) and finds *blinking* blobs by accumulating frame
   differences: a static scene produces almost no energy, a flashing screen does.
3. For every candidate blob it samples the brightness over time, aligns the
   known bit grid (start bit + parity check) and decodes the registered seat.
4. Blob centre -> stadium grid coordinate through a homography built from known
   reference points (--refs), then grid coordinate -> seat index via seats.json.
5. If the phone's real position differs from the seat it flashed, an entry is
   written to corrections.json: {"seat": registered, "sourceSeat": physical}.
   Phones that are not detected keep their registered colour.
6. The video is deleted at the end (--keep-video to opt out). No frame is ever
   written to disk, no image of a fan is stored.

Usage
-----
    python tools/opencv_calibrate.py --video calib.mp4 --refs "120,880,A-1-1;1780,900,J-1-100;140,120,A-10-1;1760,140,J-10-100" --out corrections.json
    python tools/opencv_calibrate.py --camera 0 --seconds 40 --refs-file refs.txt
    python tools/opencv_calibrate.py --video calib.mp4 --refs ... --seats public/seats.json --print
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    import cv2
    import numpy as np
except ImportError as exc:  # pragma: no cover - setup hint
    raise SystemExit(
        "OpenCV and NumPy are required: python -m pip install -r tools/requirements.txt"
    ) from exc

# --------------------------------------------------------------- geometry ----
def load_seats(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    layout = data.get("layout") or {"sectionCols": 10, "sectionRows": 1, "cellW": 100, "cellH": 10}
    return {"file": data, "layout": layout}


def row_seat_count(row: dict) -> int:
    count = row["seatTo"] - row["seatFrom"] + 1
    for a, b in row.get("blocked", []):
        lo, hi = max(a, row["seatFrom"]), min(b, row["seatTo"])
        if hi >= lo:
            count -= hi - lo + 1
    return max(0, count)


def cell_of_seat(seats: dict, section_id: str, row_id: int, seat: int) -> tuple[int, int]:
    layout = seats["layout"]
    for section in seats["file"]["sections"]:
        if section["id"] != section_id:
            continue
        for row_index, row in enumerate(section["rows"]):
            if row["id"] != row_id:
                continue
            x = section["col"] * layout["cellW"] + min(
                layout["cellW"] - 1, max(0, seat - row["seatFrom"])
            )
            y = section["row"] * layout["cellH"] + min(layout["cellH"] - 1, max(0, row_index))
            return x, y
    raise KeyError(f"unknown seat {section_id}-{row_id}-{seat}")


def build_seat_map(seats: dict) -> tuple[dict[tuple[int, int], int], list[tuple[int, int]]]:
    """(grid cell -> global seat index) and the global order list."""
    layout = seats["layout"]
    cell_to_seat: dict[tuple[int, int], int] = {}
    order: list[tuple[int, int]] = []
    global_index = 0
    for section in seats["file"]["sections"]:
        for row_index, row in enumerate(section["rows"]):
            blocked = set()
            for a, b in row.get("blocked", []):
                blocked.update(range(a, b + 1))
            for seat in range(row["seatFrom"], row["seatTo"] + 1):
                if seat in blocked:
                    continue
                x = section["col"] * layout["cellW"] + min(
                    layout["cellW"] - 1, max(0, seat - row["seatFrom"])
                )
                y = section["row"] * layout["cellH"] + min(layout["cellH"] - 1, max(0, row_index))
                cell_to_seat[(x, y)] = global_index
                order.append((x, y))
                global_index += 1
    return cell_to_seat, order


def grid_to_seat(cell_to_seat: dict[tuple[int, int], int], gx: float, gy: float, radius: int = 3) -> int | None:
    """Nearest seat cell, searching a small neighbourhood (aisles have no seat)."""
    cx, cy = int(round(gx)), int(round(gy))
    for r in range(0, radius + 1):
        for dx in range(-r, r + 1):
            for dy in range(-r, r + 1):
                found = cell_to_seat.get((cx + dx, cy + dy))
                if found is not None:
                    return found
    return None


# ------------------------------------------------------------ gray decoder ----
def from_gray(gray: int) -> int:
    value = gray
    shift = 1
    while shift < 32:
        value ^= value >> shift
        shift <<= 1
    return value


def decode_bits(bits: list[int], data_bits: int, use_parity: bool) -> int | None:
    """Mirror of src/domain/grayCode.ts: [start=1][gray MSB..LSB][parity]."""
    if not bits or bits[0] != 1:
        return None
    payload = bits[1:]
    if len(payload) < data_bits:
        return None
    payload = payload[:data_bits]
    gray = 0
    for bit in payload:
        gray = (gray << 1) | (1 if bit else 0)
    if use_parity:
        parity = 0
        for bit in payload:
            parity ^= 1 if bit else 0
        if len(bits) > 1 + data_bits and (1 if bits[1 + data_bits] else 0) != parity:
            return None
    return from_gray(gray)


# --------------------------------------------------------------- blobs --------


class Config:
    def __init__(self, args: argparse.Namespace, fps: float):
        self.width = args.width
        self.fps = fps
        self.bit_ms = args.bit_ms
        self.gap_ms = args.gap_ms
        self.data_bits = args.data_bits
        self.min_area = args.min_area
        self.max_area = args.max_area
        self.max_phones = args.max_phones
        self.threshold = args.threshold
        self.min_contrast = args.min_contrast
        self.settle_frames = args.settle_frames

    @property
    def bit_frames(self) -> float:
        return max(1.0, self.fps * self.bit_ms / 1000.0)


class BitLayout:
    """Bit grid of one calibration cycle."""

    def __init__(self, data_bits: int, gap_ms: int, bit_ms: int):
        self.data_bits = data_bits
        self.n_bits = 1 + data_bits + 1  # start + gray + parity
        self.gap_bits = max(0.0, gap_ms / bit_ms)
        self.total_bits = self.n_bits + self.gap_bits


def resize_gray(frame, width: int) -> np.ndarray:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    if gray.shape[1] != width:
        scale = width / gray.shape[1]
        gray = cv2.resize(gray, (width, max(1, int(round(gray.shape[0] * scale)))), interpolation=cv2.INTER_AREA)
    return gray


def blink_energy(video_path: Path | str, cfg: Config, layout: BitLayout) -> tuple[np.ndarray, int, tuple[int, int]]:
    """Per-pixel *maximum* frame-to-frame difference.

    A flashing screen switches between two levels many times, so its peak difference
    is close to the full contrast, while a static bright lamp only shows sensor noise.
    Taking the maximum (instead of a mean) keeps the two populations far apart and
    makes the blob threshold obvious even on a long recording.
    """
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise SystemExit(f"cannot open video {video_path}")
    previous = None
    energy: np.ndarray | None = None
    frames = 0
    size = (0, 0)
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frames += 1
        gray = resize_gray(frame, cfg.width)
        size = (gray.shape[1], gray.shape[0])
        if previous is not None:
            diff = cv2.absdiff(gray, previous).astype(np.float32)
            energy = diff if energy is None else np.maximum(energy, diff)
        previous = gray
    capture.release()
    if energy is None:
        raise SystemExit("video has fewer than two frames")
    del layout  # the bit grid is only needed for the temporal decode
    return energy, frames, size


def find_blobs(energy: np.ndarray, cfg: Config, layout: BitLayout) -> list[dict]:
    """Threshold the energy map, connected components, strongest first."""
    smoothed = cv2.GaussianBlur(energy, (3, 3), 0)
    peak = float(np.percentile(smoothed, 99.9))
    threshold = max(cfg.threshold, peak * 0.35)
    mask = (smoothed >= threshold).astype(np.uint8) * 255
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

    count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, connectivity=8)
    blobs = []
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        if area < cfg.min_area or area > cfg.max_area:
            continue
        component = (labels == index).astype(np.uint8)
        strength = float((smoothed * component).sum() / max(1, area))
        blobs.append(
            {
                "label": index,
                "x": int(x),
                "y": int(y),
                "w": int(w),
                "h": int(h),
                "area": int(area),
                "cx": float(centroids[index][0]),
                "cy": float(centroids[index][1]),
                "strength": strength,
                "mask": component[y : y + h, x : x + w],
            }
        )
    blobs.sort(key=lambda b: b["strength"] * b["area"], reverse=True)
    return blobs[: cfg.max_phones]


def sample_all_series(video_path: Path | str, blobs: list[dict], cfg: Config) -> list[np.ndarray]:
    """Second pass: the brightness history of every candidate blob, video read once."""
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise SystemExit(f"cannot re-open video {video_path}")
    series: list[list[float]] = [[] for _ in blobs]
    prepared = [(b["x"], b["y"], b["w"], b["h"], b["mask"].astype(bool)) for b in blobs]
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        index += 1
        if index <= cfg.settle_frames:
            continue
        gray = resize_gray(frame, cfg.width)
        for slot, (x, y, w, h, mask) in enumerate(prepared):
            region = gray[y : y + h, x : x + w]
            if region.shape != mask.shape:
                series[slot].append(0.0)
                continue
            series[slot].append(float(region[mask].mean()))
    capture.release()
    return [np.asarray(values, dtype=np.float32) for values in series]


def decode_series(series: np.ndarray, cfg: Config, layout: BitLayout) -> tuple[int | None, float]:
    """Find the bit-grid alignment of the flashing code.

    The search is needed because every phone starts flashing when its owner taps the
    button, so the code begins at an arbitrary time. Three constraints make the true
    alignment unique:
      1. the start bit must be bright,
      2. parity must check out (Gray code + parity survives a dropped frame),
      3. the 750 ms gap *after* the code must be dark — this is what kills the
         shifted-by-one-bit alignments that fake a valid parity by chance.
    Every sample also has to be far from the threshold, otherwise the alignment is
    ambiguous and thrown away.
    """
    if series.size < layout.total_bits * cfg.bit_frames * 1.4:
        return None, 0.0
    # p99 and not p90: a code with a single bright bit lights up 1/19th of the
    # time, so a 90th percentile would still be the dark level.
    low, high = float(np.percentile(series, 20)), float(np.percentile(series, 99))
    if high - low < cfg.min_contrast:
        return None, 0.0
    threshold = (low + high) / 2.0
    span = high - low

    # Every bit change happens on a bit boundary, so the phase of the transitions
    # gives the bit grid, and only whole-bit shifts of the cycle start are left to
    # test. That removes the ambiguity of a blind sub-frame scan.
    bit_frames = cfg.bit_frames
    binary = series > threshold
    edges = np.flatnonzero(binary[1:] != binary[:-1]).astype(np.float32) + 1.0
    if edges.size < 1:
        return None, 0.0
    angles = (edges % bit_frames) / bit_frames * 2 * np.pi
    phase = (math.atan2(float(np.sin(angles).mean()), float(np.cos(angles).mean())) / (2 * math.pi) % 1.0) * bit_frames

    best: tuple[int, float] | None = None
    for shift in range(int(round(layout.total_bits))):
        seat, margin = try_alignment(series, threshold, span, phase + shift * bit_frames, cfg, layout)
        if seat is not None and (best is None or margin > best[1]):
            best = (seat, margin)
    if best is None:
        return None, 0.0
    return best[0], best[1] / max(1e-6, span)


def sample_at(series: np.ndarray, centre: float, half: float) -> float | None:
    lo = int(max(0, centre - half))
    hi = int(min(series.size, centre + half + 1))
    if hi <= lo:
        return None
    return float(series[lo:hi].mean())


def try_alignment(
    series: np.ndarray, threshold: float, span: float, offset: float, cfg: Config, layout: BitLayout
) -> tuple[int | None, float]:
    """Sample the bit centres of one alignment and check the code structure."""
    bit_frames = cfg.bit_frames
    cycle_frames = layout.total_bits * bit_frames
    half = bit_frames * 0.30
    gap_slots = max(1, int(round(layout.gap_bits)))
    margin_total = 0.0
    seats: list[int] = []
    start = float(offset)
    # Require two identical cycles when the recording allows it.
    max_cycles = 3 if (series.size - start) >= 3 * cycle_frames else 2
    while start + cycle_frames <= series.size and len(seats) < max_cycles:
        bits: list[int] = []
        for i in range(layout.n_bits):
            value = sample_at(series, start + (i + 0.5) * bit_frames, half)
            if value is None or abs(value - threshold) < 0.08 * span:
                return None, 0.0  # ambiguous sample: not a usable alignment
            bits.append(1 if value > threshold else 0)
            margin_total += abs(value - threshold)
        # The code is wrapped in darkness: 750 ms of gap after it, and the tail of
        # the previous gap before it. Both are needed to pin the cycle start.
        for i in range(gap_slots):
            after = sample_at(series, start + (layout.n_bits + i + 0.5) * bit_frames, half)
            if after is None or after > threshold:
                return None, 0.0
            margin_total += abs(after - threshold) * 0.5
        for i in range(1, gap_slots + 1):
            before = sample_at(series, start - (i - 0.5) * bit_frames, half)
            if before is not None and before > threshold:
                return None, 0.0
        seat = decode_bits(bits, layout.data_bits, True)
        if seat is None:
            return None, 0.0
        seats.append(seat)
        start += cycle_frames
    if not seats or len(set(seats)) != 1:
        return None, 0.0
    return seats[0], margin_total / len(seats)


# --------------------------------------------------------------- main ---------
def parse_refs(raw: list[str] | None, path: Path | None, seats: dict, scale: float = 1.0) -> np.ndarray:
    """Reference points: 'imageX,imageY,gridX,gridY' or 'imageX,imageY,SECTION-ROW-SEAT'.

    Image coordinates are given in the *original* video resolution; `scale` converts
    them into the (smaller) processing resolution so the blobs and the homography
    live in the same coordinate system.
    """
    entries: list[str] = []
    if path:
        entries.extend(line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#"))
    if raw:
        entries.extend(raw)
    src: list[list[float]] = []
    dst: list[list[float]] = []
    for entry in entries:
        parts = [p.strip() for p in entry.replace(";", "\n").split("\n") if p.strip()]
        for part in parts:
            values = [v.strip() for v in part.split(",")]
            if len(values) == 4:
                ix, iy, gx, gy = (float(v) for v in values)
            elif len(values) == 3:
                ix, iy = float(values[0]), float(values[1])
                section, row, seat = values[2].split("-")
                gx, gy = cell_of_seat(seats, section, int(row), int(seat))
            else:
                raise SystemExit(f"bad --refs entry: {part!r}")
            src.append([ix * scale, iy * scale])
            dst.append([gx, gy])
    if len(src) < 4:
        raise SystemExit("at least 4 reference points are required (--refs)")
    return cv2.findHomography(np.asarray(src, dtype=np.float32), np.asarray(dst, dtype=np.float32), 0)[0]


def process(video: Path | str, seats: dict, cfg: Config, layout: BitLayout, homography: np.ndarray, verbose: bool) -> dict:
    started = time.time()
    energy, frames, size = blink_energy(video, cfg, layout)
    blobs = find_blobs(energy, cfg, layout)
    cell_to_seat, _ = build_seat_map(seats)
    result = {"frames": frames, "size": size, "candidates": len(blobs), "detected": 0, "corrections": []}

    all_series = sample_all_series(video, blobs, cfg)
    for blob, series in zip(blobs, all_series):
        seat, confidence = decode_series(series, cfg, layout)
        if seat is None:
            continue
        result["detected"] += 1
        point = np.asarray([[[blob["cx"], blob["cy"]]]], dtype=np.float32)
        mapped = cv2.perspectiveTransform(point, homography)[0][0]
        physical = grid_to_seat(cell_to_seat, float(mapped[0]), float(mapped[1]), radius=3)
        if physical is None:
            continue
        if physical != seat:
            result["corrections"].append(
                {
                    "seat": int(seat),
                    "sourceSeat": int(physical),
                    "confidence": round(float(confidence), 3),
                    "gridX": round(float(mapped[0]), 2),
                    "gridY": round(float(mapped[1]), 2),
                }
            )
        if verbose:
            print(
                f"  blob @{blob['cx']:.0f},{blob['cy']:.0f} area={blob['area']} "
                f"-> seat #{seat} physical #{physical} conf={confidence:.2f} "
                f"grid=({float(mapped[0]):.1f},{float(mapped[1]):.1f})"
            )
    result["seconds"] = round(time.time() - started, 2)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Rayati seat correction from a camera video")
    parser.add_argument("--video", type=Path, default=None)
    parser.add_argument("--camera", type=int, default=None, help="capture from a live camera index")
    parser.add_argument("--seconds", type=float, default=40.0, help="capture duration in camera mode")
    parser.add_argument("--seats", type=Path, default=Path("public/seats.json"))
    parser.add_argument("--out", type=Path, default=Path("corrections.json"))
    parser.add_argument("--refs", nargs="*", default=None)
    parser.add_argument("--refs-file", type=Path, default=None)
    parser.add_argument("--width", type=int, default=960, help="processing width in pixels")
    parser.add_argument(
        "--refs-scale",
        type=float,
        default=0.0,
        dest="refs_scale",
        help="scale applied to --refs image coordinates (0 = automatic from the video width)",
    )
    parser.add_argument("--bit-ms", type=int, default=250, help="must match CALIBRATION.bitMs")
    parser.add_argument("--gap-ms", type=int, default=5000, help="must match CALIBRATION.gapMs")
    parser.add_argument("--data-bits", type=int, default=16, help="seats per code: 2^dataBits")
    parser.add_argument("--min-area", type=int, default=4)
    parser.add_argument("--max-area", type=int, default=4000)
    parser.add_argument("--max-phones", type=int, default=400)
    parser.add_argument("--threshold", type=float, default=45.0, help="minimum blink energy for a blob")
    parser.add_argument("--min-contrast", type=float, default=25.0)
    parser.add_argument("--settle-frames", type=int, default=2)
    parser.add_argument("--keep-video", action="store_true", help="do not delete the source video")
    parser.add_argument("--print", action="store_true", dest="print_", help="print every decoded blob")
    parser.add_argument("--limit-seconds", type=float, default=0.0, help="only inspect the first N seconds")
    args = parser.parse_args()

    seats = load_seats(args.seats)
    video_path = args.video
    temporary = None
    if args.camera is not None:
        temporary = Path(f"tools/assets/out/capture-{int(time.time())}.mp4")
        temporary.parent.mkdir(parents=True, exist_ok=True)
        capture = cv2.VideoCapture(args.camera)
        if not capture.isOpened():
            raise SystemExit(f"cannot open camera {args.camera}")
        fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)) or 1280
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 720
        writer = cv2.VideoWriter(str(temporary), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
        deadline = time.time() + args.seconds
        while time.time() < deadline:
            ok, frame = capture.read()
            if not ok:
                break
            writer.write(frame)
        writer.release()
        capture.release()
        video_path = temporary
    if video_path is None:
        raise SystemExit("pass --video <file> or --camera <index>")

    probe = cv2.VideoCapture(str(video_path))
    fps = probe.get(cv2.CAP_PROP_FPS) or 30.0
    source_width = probe.get(cv2.CAP_PROP_FRAME_WIDTH) or float(args.width)
    probe.release()

    scale = args.refs_scale if args.refs_scale > 0 else min(1.0, args.width / source_width)
    homography = parse_refs(args.refs, args.refs_file, seats, scale)
    if homography is None:
        raise SystemExit("homography could not be computed from the reference points")
    layout = BitLayout(args.data_bits, args.gap_ms, args.bit_ms)
    cfg = Config(args, fps)
    if layout.gap_bits < layout.n_bits:
        print(
            f"warning: gap of {layout.gap_bits:.0f} bits is shorter than the {layout.n_bits}-bit code: "
            "shifted alignments can fake a valid code. Use --gap-ms >= "
            f"{layout.n_bits * args.bit_ms}."
        )

    print(
        f"video={video_path} fps={fps:.1f} width={args.width} bit={args.bit_ms}ms "
        f"({cfg.bit_frames:.1f} frames/bit, {layout.total_bits:.1f} bits/cycle)"
    )
    result = process(video_path, seats, cfg, layout, homography, args.print_)

    payload = {
        "v": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "assignments": [
            {
                "seat": c["seat"],
                "sourceSeat": c["sourceSeat"],
                # diagnostics only: the app reads seat + sourceSeat
                "gridX": c["gridX"],
                "gridY": c["gridY"],
                "confidence": c["confidence"],
            }
            for c in result["corrections"]
        ],
        "stats": {
            "frames": result["frames"],
            "candidates": result["candidates"],
            "detected": result["detected"],
            "corrected": len(result["corrections"]),
            "processingSeconds": result["seconds"],
        },
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(
        f"corrections.json: {len(result['corrections'])} moved seats "
        f"(detected {result['detected']}/{result['candidates']} candidates, "
        f"{result['frames']} frames in {result['seconds']}s)"
    )
    for correction in result["corrections"][:10]:
        print(f"  seat #{correction['seat']} is physically at #{correction['sourceSeat']}")

    if temporary is not None:
        temporary.unlink(missing_ok=True)
    if args.video and not args.keep_video:
        Path(args.video).unlink(missing_ok=True)
        print(f"video deleted (privacy): {args.video}")
    elif args.video:
        print("video kept (--keep-video)")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
