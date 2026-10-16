#!/usr/bin/env python3
"""Generate seats.json for any stadium size.

The file stores ranges, not a seat list, so 50 000 seats stay a few kilobytes:
    {"id": "A", "rows": [{"id": 1, "seatFrom": 1, "seatTo": 100, "blocked": [[5, 7]]}]}

Seat numbering is 1-based, sections are letters (A, B, C...), and the global seat
index used by show.json follows this exact order:

    sections in file order -> rows ascending -> seats ascending (blocked skipped)

Never change that order without regenerating show.json: the timeline index map
depends on it.

Usage:
    python tools/generate_seats.py --out public/seats.json
    python tools/generate_seats.py --sections 12 --rows 20 --seats-per-row 60 --out seats.json
"""

from __future__ import annotations

import argparse
import json
import random
from datetime import datetime, timezone
from pathlib import Path

LANG_KEYS = ("ar", "fr", "en")


def section_letter(index: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA (enough for any stadium)."""
    letters = ""
    index += 1
    while index > 0:
        index, rem = divmod(index - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def layout_for(count: int) -> tuple[int, int]:
    """Panorama layout: sections as close to a square grid as possible."""
    cols = int(count**0.5)
    while cols > 1 and count % cols != 0:
        cols -= 1
    return cols, max(1, count // cols)


def build_seats(
    sections: int,
    rows: int,
    seats_per_row: int,
    stadium_name: str,
    seed: int,
    blocked_ratio: float,
) -> dict:
    rng = random.Random(seed)
    cols, grid_rows = layout_for(sections)
    section_defs = []

    for s in range(sections):
        sid = section_letter(s)
        row_defs = []
        for r in range(1, rows + 1):
            blocked: list[list[int]] = []
            # Deterministic aisles: a gap every 25 seats keeps the grid realistic.
            if seats_per_row >= 25:
                for start in range(25, seats_per_row, 25):
                    blocked.append([start, start])  # one-seat aisle
            # A few random missing seats (pillars, camera spots).
            while rng.random() < blocked_ratio:
                spot = rng.randint(1, seats_per_row)
                if not any(a <= spot <= b for a, b in blocked):
                    blocked.append([spot, spot])
            blocked.sort()
            # Merge touching ranges so the file stays small.
            merged: list[list[int]] = []
            for a, b in blocked:
                if merged and a <= merged[-1][1] + 1:
                    merged[-1][1] = max(merged[-1][1], b)
                else:
                    merged.append([a, b])
            row_def = {"id": r, "seatFrom": 1, "seatTo": seats_per_row}
            if merged:
                row_def["blocked"] = merged
            row_defs.append(row_def)

        section_defs.append(
            {
                "id": sid,
                "name": {lang: sid for lang in LANG_KEYS},
                "col": s % cols,
                "row": s // cols,
                "rows": row_defs,
            }
        )

    capacity = sum(
        (row["seatTo"] - row["seatFrom"] + 1)
        - sum(b - a + 1 for a, b in row.get("blocked", []))
        for section in section_defs
        for row in section["rows"]
    )

    return {
        "v": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "stadium": {"name": stadium_name, "capacity": capacity},
        "layout": {
            "sectionCols": cols,
            "sectionRows": grid_rows,
            "cellW": seats_per_row,
            "cellH": rows,
        },
        "sections": section_defs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Rayati seats.json")
    parser.add_argument("--sections", type=int, default=10)
    parser.add_argument("--rows", type=int, default=10)
    parser.add_argument("--seats-per-row", type=int, default=100, dest="seats_per_row")
    parser.add_argument("--stadium", default="ملعب راياتي الوطني")
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--blocked-ratio", type=float, default=0.004, dest="blocked_ratio")
    parser.add_argument("--out", type=Path, default=Path("public/seats.json"))
    args = parser.parse_args()

    data = build_seats(
        args.sections, args.rows, args.seats_per_row, args.stadium, args.seed, args.blocked_ratio
    )
    if args.out.parent != Path(""):
        args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    size = args.out.stat().st_size
    print(
        f"seats.json: {data['stadium']['capacity']} seats · "
        f"{args.sections} sections x {args.rows} rows x {args.seats_per_row} seats · "
        f"{size / 1024:.1f} KB"
    )


if __name__ == "__main__":
    main()
