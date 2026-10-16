#!/usr/bin/env python3
"""Build the single stadium-wide show.json from any image (logo, flag, wordmark).

How the file stays small
------------------------
1. The show is a list of *acts* (default 400 ms). One act = one still picture.
2. A seat's colour at any time is a pure function of exactly two things:
     - its *base mood*: (hue, level) read from the image (green / white / red / gold),
     - its *position bucket*: the quantised panorama coordinate of the seat.
   Unused (black) seats stay pure black for the whole show.
3. So the number of distinct timelines is at most palette x buckets (~16 x 12),
   and each timeline is run-length encoded. Neither the number of seats nor the
   number of distinct pictures inflates the file: only the number of *behaviours*.
4. Seat -> timeline is a run-length encoded index map in the exact seat order of
   seats.json (sections, then rows, then seats). Bucket grouping is spatially
   contiguous, so the index map is tiny.

Usage
-----
    python tools/build_show.py --preset algeria --out public/show.json
    python tools/build_show.py --image tools/assets/logo.png --duration 600 --preview out.png
    python tools/build_show.py --seats seats.json --image flag.png --chunk-size 5000 --out public/show.json
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError as exc:  # pragma: no cover - setup hint
    raise SystemExit(
        "Pillow is required: python -m pip install -r tools/requirements.txt"
    ) from exc

# ---------------------------------------------------------------- palette ----
HUE_OFF = "off"
HUE_GREEN = "green"
HUE_WHITE = "white"
HUE_RED = "red"
HUE_GOLD = "gold"
HUES = (HUE_GREEN, HUE_WHITE, HUE_RED, HUE_GOLD)

# level 3 = full brightness, 2 = base, 1 = dim. High contrast only, and the
# Algerian green/white/red/gold identity is baked in.
LEVEL_COLORS: dict[str, dict[int, str]] = {
    HUE_OFF: {1: "#000000", 2: "#000000", 3: "#000000"},
    HUE_GREEN: {1: "#082B14", 2: "#0A7D3E", 3: "#12C262"},
    HUE_WHITE: {1: "#3A3F46", 2: "#A8B2BD", 3: "#FFFFFF"},
    HUE_RED: {1: "#4A0A16", 2: "#D21034", 3: "#FF3B5C"},
    HUE_GOLD: {1: "#3F3210", 2: "#B58C2A", 3: "#E8B84B"},
}

# Extra swatches: they make the image mapping smoother, and each one declares
# the mood it behaves like during the show.
EXTRAS: list[tuple[str, tuple[str, int]]] = [
    ("#062B14", (HUE_GREEN, 1)),
    ("#FFE9A8", (HUE_GOLD, 3)),
    ("#0B0F14", (HUE_OFF, 2)),
]


def build_palette() -> tuple[list[str], dict[int, tuple[str, int]], dict[tuple[str, int], int]]:
    """Palette array + index->mood + mood->index (index 0 must stay pure black)."""
    palette: list[str] = []
    mood_of: dict[int, tuple[str, int]] = {}
    index_of: dict[tuple[str, int], int] = {}

    palette.append(LEVEL_COLORS[HUE_OFF][1])
    mood_of[0] = (HUE_OFF, 1)
    index_of[(HUE_OFF, 1)] = 0

    for hue in HUES:
        for level in (3, 2, 1):
            index = len(palette)
            palette.append(LEVEL_COLORS[hue][level])
            mood_of[index] = (hue, level)
            index_of[(hue, level)] = index

    for hex_color, mood in EXTRAS:
        if len(palette) >= 16:
            break
        index = len(palette)
        palette.append(hex_color)
        mood_of[index] = mood
        index_of.setdefault(mood, index)

    return palette, mood_of, index_of


PALETTE, MOOD_OF, INDEX_OF = build_palette()


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))


PALETTE_RGB = [hex_to_rgb(c) for c in PALETTE]


# Index 0 (pure black) and the near-black swatch are never chosen by the image
# mapping: a dark antialiased edge must not create a permanently black seat.
MAPPING_CANDIDATES = [i for i in range(1, len(PALETTE) - 1)]
BLACK_THRESHOLD = 12


def nearest_index(rgb: tuple[int, int, int]) -> int:
    """Nearest palette colour (Pillow-only, fast enough for 10k-50k cells)."""
    r, g, b = rgb
    if max(r, g, b) <= BLACK_THRESHOLD:
        return 0  # unused / off seat
    best = MAPPING_CANDIDATES[0]
    best_distance = 1 << 30
    for index in MAPPING_CANDIDATES:
        pr, pg, pb = PALETTE_RGB[index]
        dr, dg, db = r - pr, g - pg, b - pb
        distance = dr * dr + dg * dg + db * db
        if distance < best_distance:
            best_distance = distance
            best = index
    return best


# ------------------------------------------------------------------ image ----
def draw_algeria(width: int = 1500, height: int = 1000) -> "Image.Image":
    """Default source: the Algerian flag, drawn procedurally (no asset needed)."""
    image = Image.new("RGB", (width, height), "#FFFFFF")
    draw = ImageDraw.Draw(image)
    draw.rectangle([0, 0, int(width * 0.4), height], fill=LEVEL_COLORS[HUE_GREEN][2])
    radius = height * 0.28
    cx, cy = width * 0.56, height * 0.5
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=LEVEL_COLORS[HUE_RED][2])
    draw.ellipse(
        [cx - radius * 0.82, cy - radius, cx + radius * 1.18, cy + radius],
        fill="#FFFFFF",
    )
    # Five-point star.
    star_r, star_ir = radius * 0.42, radius * 0.17
    points = []
    for i in range(10):
        r = star_r if i % 2 == 0 else star_ir
        angle = -math.pi / 2 + i * math.pi / 5
        points.append((cx + radius * 0.9 + r * math.cos(angle), cy + r * math.sin(angle)))
    draw.polygon(points, fill=LEVEL_COLORS[HUE_RED][2])
    return image


def load_source(path: Path | None, preset: str, canvas_w: int, canvas_h: int) -> "Image.Image":
    if path:
        return Image.open(path).convert("RGB")
    if preset == "checker":
        image = Image.new("RGB", (canvas_w * 8, canvas_h * 8), "#000000")
        draw = ImageDraw.Draw(image)
        for y in range(0, canvas_h * 8, canvas_h * 4):
            for x in range(0, canvas_w * 8, canvas_w * 4):
                draw.rectangle([x, y, x + canvas_w * 4, y + canvas_h * 4], fill="#FFFFFF")
        return image
    if preset == "wordmark":
        image = Image.new("RGB", (canvas_w, canvas_h), "#000000")
        draw = ImageDraw.Draw(image)
        draw.rectangle([0, 0, canvas_w // 3, canvas_h], fill=LEVEL_COLORS[HUE_GREEN][3])
        draw.rectangle([canvas_w // 3, canvas_h // 3, 2 * canvas_w // 3, 2 * canvas_h // 3], fill="#FFFFFF")
        draw.rectangle([2 * canvas_w // 3, 0, canvas_w, canvas_h], fill=LEVEL_COLORS[HUE_RED][2])
        return image
    return draw_algeria()


def fit(image: "Image.Image", size: tuple[int, int], mode: str) -> "Image.Image":
    """How the artwork fills the stadium grid.

    A crowd picture is *designed* for the grid: you make a 200x50 poster and every
    seat gets a pixel of it. `stretch` (the default) does exactly that. `cover`
    crops like a camera would, `contain` letterboxes and leaves black seats.

    BOX (area average) is used instead of LANCZOS: downsampling to 10 rows with a
    kernel that overshoots would create dark ringing artefacts between colours.
    """
    width, height = size
    if mode == "stretch":
        return image.resize(size, Image.BOX)
    ratio = image.width / image.height
    target = width / height
    if mode == "contain":
        scale = min(width / image.width, height / image.height)
        resized = image.resize((max(1, int(image.width * scale)), max(1, int(image.height * scale))), Image.BOX)
        canvas = Image.new("RGB", size, "#000000")
        canvas.paste(resized, ((width - resized.width) // 2, (height - resized.height) // 2))
        return canvas
    if ratio > target:  # too wide: crop the sides
        new_w = int(image.height * target)
        left = (image.width - new_w) // 2
        cropped = image.crop((left, 0, left + new_w, image.height))
    else:  # too tall: crop top and bottom
        new_h = int(image.width / target)
        top = (image.height - new_h) // 2
        cropped = image.crop((0, top, image.width, top + new_h))
    return cropped.resize(size, Image.BOX)


# ------------------------------------------------------------------- seats ----
def load_seats(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("v") != 1:
        print(f"warning: seats.json version {data.get('v')} (expected 1)")
    return data


def row_seat_count(row: dict) -> int:
    count = row["seatTo"] - row["seatFrom"] + 1
    for a, b in row.get("blocked", []):
        lo, hi = max(a, row["seatFrom"]), min(b, row["seatTo"])
        if hi >= lo:
            count -= hi - lo + 1
    return max(0, count)


def cell_of_seat(section: dict, row: dict, row_index: int, seat: int, layout: dict) -> tuple[int, int]:
    """Same geometry as the app and the simulation view."""
    x = section["col"] * layout["cellW"] + min(layout["cellW"] - 1, max(0, seat - row["seatFrom"]))
    y = section["row"] * layout["cellH"] + min(layout["cellH"] - 1, max(0, row_index))
    return x, y


def enumerate_seats(seats: dict) -> list[tuple[int, int, int]]:
    """[(seat_global_index, x, y)] in the exact order the app enumerates."""
    layout = seats["layout"]
    out: list[tuple[int, int, int]] = []
    global_index = 0
    for section in seats["sections"]:
        for row_index, row in enumerate(section["rows"]):
            blocked = set()
            for a, b in row.get("blocked", []):
                blocked.update(range(a, b + 1))
            for seat in range(row["seatFrom"], row["seatTo"] + 1):
                if seat in blocked:
                    continue
                x, y = cell_of_seat(section, row, row_index, seat, layout)
                out.append((global_index, x, y))
                global_index += 1
    return out


# ------------------------------------------------------------------- show ----
def wave_delta(t: int, bucket: int, cfg: dict) -> int:
    """-1 / 0 / +1 brightness offset: a travelling wave plus a slow global breathe."""
    phase = 2 * math.pi * (t / cfg["cycle_ms"]) - 2 * math.pi * cfg["waves"] * (bucket / cfg["buckets"])
    value = math.sin(phase)
    breathe = 0.35 * math.sin(2 * math.pi * t / cfg["breathe_ms"])
    if value + breathe > 0.45:
        return 1
    if value + breathe < -0.45:
        return -1
    return 0


def index_at(t: int, base_index: int, bucket: int, cfg: dict) -> int:
    """Palette index for a seat mood at time t. Pure function -> perfect dedupe."""
    hue, base_level = MOOD_OF[base_index]
    if hue == HUE_OFF:
        return 0  # unused seats stay pure black

    duration = cfg["duration_ms"]
    intro = cfg["intro_ms"]
    outro = cfg["outro_ms"]

    # 1) entrance wipe: a gold light band travels across the stands
    reveal = (bucket / cfg["buckets"]) * intro
    if t < reveal:
        return 0
    if t < reveal + cfg["band_ms"]:
        return INDEX_OF[(HUE_GOLD, 3)]
    if t > duration - outro:
        # 3) finale, identical for every seat -> free
        p = (t - (duration - outro)) / outro
        if p < 0.3:
            return INDEX_OF[(HUE_WHITE, 3)] if (t // cfg["flash_ms"]) % 2 == 0 else 0
        if p < 0.55:
            return INDEX_OF[(hue, 3)]
        if p < 0.85:
            return INDEX_OF[(hue, 1)]
        return 0

    # 2) waving flag: brightness travels along the stands
    level = min(3, max(1, base_level + wave_delta(t, bucket, cfg)))
    return INDEX_OF[(hue, level)]


def build_timeline(base_index: int, bucket: int, cfg: dict) -> list[list[int]]:
    """Run-length encoded [paletteIndex, durationMs] for one (mood, bucket) pair."""
    steps: list[list[int]] = []
    for act in range(cfg["acts"]):
        t = act * cfg["act_ms"]
        index = index_at(t, base_index, bucket, cfg)
        if steps and steps[-1][0] == index:
            steps[-1][1] += cfg["act_ms"]
        else:
            steps.append([index, cfg["act_ms"]])
    if steps:
        # Round the tail up to the exact duration.
        steps[-1][1] += cfg["duration_ms"] - cfg["acts"] * cfg["act_ms"]
    return steps or [[0, cfg["duration_ms"]]]


def rle(values: list[int]) -> list[list[int]]:
    runs: list[list[int]] = []
    for value in values:
        if runs and runs[-1][0] == value:
            runs[-1][1] += 1
        else:
            runs.append([value, 1])
    return runs


def build_show(seats: dict, image: "Image.Image", cfg: dict) -> tuple[dict, dict]:
    layout = seats["layout"]
    width = layout["sectionCols"] * layout["cellW"]
    height = layout["sectionRows"] * layout["cellH"]
    canvas = fit(image, (width, height), cfg["fit"])
    pixels = canvas.load()

    seat_list = enumerate_seats(seats)
    seat_count = len(seat_list)

    # base mood palette index + position bucket per seat (global order)
    base_indices: list[int] = []
    buckets: list[int] = []
    bucket_of_x: dict[int, int] = {}
    for _, x, y in seat_list:
        base_indices.append(nearest_index(pixels[x, y]))
        bucket = bucket_of_x.get(x)
        if bucket is None:
            bucket = int((x / max(1, width - 1)) * cfg["buckets"]) % cfg["buckets"]
            bucket_of_x[x] = bucket
        buckets.append(bucket)

    # unique (base, bucket) pairs -> timelines
    timeline_id: dict[tuple[int, int], int] = {}
    timelines: list[list[list[int]]] = []
    seat_timeline: list[int] = []
    for i in range(seat_count):
        key = (base_indices[i], buckets[i])
        tid = timeline_id.get(key)
        if tid is None:
            tid = len(timelines)
            timeline_id[key] = tid
            timelines.append(build_timeline(key[0], key[1], cfg))
        seat_timeline.append(tid)

    runs = rle(seat_timeline)
    meta = {
        "id": cfg["id"],
        "name": cfg["name"],
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "expiresAt": (datetime.now(timezone.utc) + timedelta(days=cfg["expires_days"])).isoformat(timespec="seconds"),
        "startAt": cfg["start_at"],
        "durationMs": cfg["duration_ms"],
        "tickMs": cfg["tick_ms"],
        "seatCount": seat_count,
        "acts": cfg["acts"],
        "actMs": cfg["act_ms"],
        "title": {"ar": cfg["name"], "fr": cfg["name"], "en": cfg["name"]},
    }

    stats = {
        "seats": seat_count,
        "timelines": len(timelines),
        "runs": sum(len(t) for t in timelines) + len(runs),
        "buckets": len(bucket_of_x),
        "preset": cfg["preset"],
    }
    return {"v": 1, "meta": meta, "palette": PALETTE, "timelines": timelines, "seatIndex": {"runs": runs}}, stats


def write_json(path: Path, payload: dict) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    path.write_text(text, encoding="utf-8")
    return len(text.encode("utf-8"))


def gzip_size(payload: dict) -> int:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return len(gzip.compress(raw, compresslevel=9))


def report(path: Path, payload: dict, stats: dict) -> None:
    raw = path.stat().st_size
    gz = gzip_size(payload)
    target = 400 * 1024 if stats["seats"] <= 10000 else 2048 * 1024
    label = "<400 KB" if stats["seats"] <= 10000 else "<2 MB"
    print(
        f"{path}: {raw / 1024:.0f} KB raw · {gz / 1024:.0f} KB gzip · "
        f"{stats['seats']} seats · {stats['timelines']} timelines · {stats['runs']} runs · "
        f"target {label} {'OK' if gz <= target else 'OVER BUDGET'}"
    )


def expand_seat_index(payload: dict) -> list[int]:
    """Expand the RLE seat index of a single-file payload."""
    if payload.get("chunks"):
        print("  note: chunked payload, preview renders the core file only")
    seat_timeline: list[int] = []
    for tid, repeat in payload["seatIndex"]["runs"]:
        seat_timeline.extend([tid] * repeat)
    return seat_timeline


def write_preview(payload: dict, seats: dict, ms: int, out: Path, zoom: int) -> None:
    """Render one instant of the show as a PNG: the desktop check before the event."""
    layout = seats["layout"]
    width = layout["sectionCols"] * layout["cellW"]
    height = layout["sectionRows"] * layout["cellH"]
    canvas = Image.new("RGB", (width, height), "#000000")
    pixels = canvas.load()
    palette_rgb = [hex_to_rgb(c) for c in payload["palette"]]
    seat_timeline = expand_seat_index(payload)

    for global_index, x, y in enumerate_seats(seats):
        if global_index >= len(seat_timeline):
            break
        tid = seat_timeline[global_index]
        steps = payload["timelines"][tid] if payload["timelines"] else None
        if steps is None:  # chunked payload: preview the core only
            continue
        color_index = timeline_index_at(steps, ms, payload["meta"]["tickMs"])
        pixels[x, y] = palette_rgb[color_index]

    out.parent.mkdir(parents=True, exist_ok=True)
    canvas = canvas.resize((width * zoom, height * zoom), Image.NEAREST)
    canvas.save(out)
    print(f"preview: {out} ({canvas.width}x{canvas.height}) at {ms} ms")


def timeline_index_at(steps: list[list[int]], ms: int, tick_ms: int) -> int:
    if not steps:
        return 0
    tick = max(0, int(ms // tick_ms))
    cursor = 0
    for value, duration in steps:
        span = max(1, int(round(duration / tick_ms)))
        if tick < cursor + span:
            return value
        cursor += span
    return steps[-1][0]


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Rayati show.json")
    parser.add_argument("--seats", type=Path, default=Path("public/seats.json"))
    parser.add_argument("--image", type=Path, default=None)
    parser.add_argument("--preset", choices=("algeria", "wordmark", "checker"), default="algeria")
    parser.add_argument("--out", type=Path, default=Path("public/show.json"))
    parser.add_argument("--duration", type=float, default=600, help="show duration in seconds")
    parser.add_argument("--act-ms", type=int, default=400, dest="act_ms")
    parser.add_argument("--tick-ms", type=int, default=100, dest="tick_ms")
    parser.add_argument("--buckets", type=int, default=12, help="position buckets (wave phases)")
    parser.add_argument("--waves", type=float, default=1.5, help="wave crests across the panorama")
    parser.add_argument("--cycle", type=float, default=6.4, help="wave cycle in seconds")
    parser.add_argument("--breathe", type=float, default=24.0, help="slow global breathe in seconds")
    parser.add_argument("--intro", type=float, default=8.0, help="entrance wipe in seconds")
    parser.add_argument("--outro", type=float, default=12.0, help="finale in seconds")
    parser.add_argument("--band", type=int, default=600, help="wipe light band width in ms")
    parser.add_argument("--flash", type=int, default=360, help="finale flash period in ms")
    parser.add_argument(
        "--fit",
        choices=("cover", "contain", "stretch"),
        default="stretch",
        help="how the image fills the stadium canvas: stretch = design for the grid "
        "(default), cover = crop like a photo, contain = letterbox with black",
    )
    parser.add_argument("--start-at", type=int, default=0, dest="start_at", help="epoch ms (0 = whenever)")
    parser.add_argument("--expires-days", type=int, default=14, dest="expires_days")
    parser.add_argument("--id", default=None)
    parser.add_argument("--name", default="راياتي · Rayati")
    parser.add_argument("--chunk-size", type=int, default=0, dest="chunk_size",
                        help="split the seat index into chunks of N seats (all prefetched)")
    parser.add_argument("--preview", type=Path, default=None)
    parser.add_argument("--preview-at-ms", type=int, default=180_000, dest="preview_at_ms")
    parser.add_argument("--preview-zoom", type=int, default=3, dest="preview_zoom")
    args = parser.parse_args()

    seats = load_seats(args.seats)
    layout = seats["layout"]
    width = layout["sectionCols"] * layout["cellW"]
    height = layout["sectionRows"] * layout["cellH"]
    image = load_source(args.image, args.preset, width, height)

    duration_ms = int(args.duration * 1000)
    act_ms = max(args.tick_ms, args.act_ms)
    acts = max(1, int(round(duration_ms / act_ms)))
    cfg = {
        "id": args.id or f"rayati-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M')}",
        "name": args.name,
        "preset": args.preset,
        "duration_ms": duration_ms,
        "act_ms": act_ms,
        "tick_ms": args.tick_ms,
        "acts": acts,
        "buckets": max(2, args.buckets),
        "waves": args.waves,
        "cycle_ms": int(args.cycle * 1000),
        "breathe_ms": int(args.breathe * 1000),
        "intro_ms": int(args.intro * 1000),
        "outro_ms": int(args.outro * 1000),
        "band_ms": args.band,
        "flash_ms": args.flash,
        "fit": args.fit,
        "start_at": args.start_at,
        "expires_days": args.expires_days,
    }

    payload, stats = build_show(seats, image, cfg)

    if args.chunk_size > 0:
        # Chunked variant: the core file lists the chunks, every chunk is prefetched.
        payload = write_chunked(payload, args.out, args.chunk_size, stats)
    write_json(args.out, payload)
    report(args.out, payload, stats)

    if args.preview:
        write_preview(payload, seats, args.preview_at_ms, args.preview, args.preview_zoom)

    print(
        f"  {stats['timelines']} behaviours · {args.buckets} buckets · {acts} acts of {act_ms} ms · "
        f"palette {len(PALETTE)} colours · fit={args.fit}"
    )


def write_chunked(payload: dict, out: Path, chunk_size: int, stats: dict) -> dict:
    """Split the seat index into chunk files; every chunk is prefetched before the event."""
    runs = payload["seatIndex"]["runs"]
    timelines = payload["timelines"]
    flat: list[int] = []
    for tid, repeat in runs:
        flat.extend([tid] * repeat)

    chunks = []
    for start in range(0, len(flat), chunk_size):
        slice_ids = flat[start : start + chunk_size]
        local: dict[int, int] = {}
        local_timelines = []
        local_runs = []
        for tid in slice_ids:
            if tid not in local:
                local[tid] = len(local_timelines)
                local_timelines.append(timelines[tid])
            value = local[tid]
            if local_runs and local_runs[-1][0] == value:
                local_runs[-1][1] += 1
            else:
                local_runs.append([value, 1])
        name = f"{out.stem}-{len(chunks):03d}{out.suffix}"
        write_json(out.with_name(name), {
            "i": len(chunks),
            "seatFrom": start,
            "seatTo": start + len(slice_ids) - 1,
            "runs": local_runs,
            "timelines": local_timelines,
        })
        chunks.append({
            "url": name,
            "seatFrom": start,
            "seatTo": start + len(slice_ids) - 1,
        })
        print(f"  chunk {name}: {len(slice_ids)} seats · {len(local_timelines)} behaviours")

    stats["chunks"] = len(chunks)
    return {
        "v": 1,
        "meta": payload["meta"],
        "palette": payload["palette"],
        "timelines": [],
        "seatIndex": {"runs": []},
        "chunks": chunks,
    }


if __name__ == "__main__":
    main()
