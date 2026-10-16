#!/usr/bin/env python3
"""End-to-end test of the Phase 2 pipeline, without a stadium.

1. tools/make_test_video.py renders a synthetic camera video: 12 phones flashing
   their Gray seat code with random phase offsets, 5 of them physically displaced,
   plus 8 static bright spots that must be ignored.
2. tools/opencv_calibrate.py processes that video with reference points and writes
   corrections.json.
3. This script compares the corrections with the ground truth and exits non-zero
   on any mismatch, so the pipeline can be run in CI before an event.

    python tools/test_calibration_pipeline.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "tools" / "assets" / "out"
VIDEO = WORK / "calib.mp4"
TRUTH = WORK / "calib.truth.json"
CORRECTIONS = WORK / "corrections.json"
SEATS = ROOT / "public" / "seats.json"


def run(*args: str) -> None:
    print(f"$ {' '.join(args)}")
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True)
    if result.stdout.strip():
        print(result.stdout.strip())
    if result.returncode != 0:
        print(result.stderr.strip(), file=sys.stderr)
        raise SystemExit(f"command failed ({result.returncode}): {' '.join(args)}")


def main() -> None:
    worker = sys.executable
    run(
        worker,
        "tools/make_test_video.py",
        "--seats",
        str(SEATS),
        "--out",
        str(VIDEO),
        "--truth",
        str(TRUTH),
        "--phones",
        "12",
        "--displaced",
        "5",
        "--seconds",
        "30",
    )
    truth = json.loads(TRUTH.read_text(encoding="utf-8"))
    refs = ";".join(f"{r[0]},{r[1]},{r[2]},{r[3]}" for r in truth["refs"])

    run(
        worker,
        "tools/opencv_calibrate.py",
        "--video",
        str(VIDEO),
        "--seats",
        str(SEATS),
        "--out",
        str(CORRECTIONS),
        "--refs",
        refs,
        "--width",
        "960",
        "--keep-video",
        "--print",
    )

    payload = json.loads(CORRECTIONS.read_text(encoding="utf-8"))
    detected = {item["seat"]: item for item in payload["assignments"]}
    expected = {phone["seat"]: phone for phone in truth["phones"]}
    displaced = {seat for seat, phone in expected.items() if phone["seat"] != phone["sourceSeat"]}

    failures: list[str] = []
    missing = sorted(set(displaced) - set(detected))
    if missing:
        failures.append(f"displaced phones not detected: {missing}")
    extra = sorted(set(detected) - set(displaced))
    if extra:
        failures.append(f"phones reported that sit on their registered seat: {extra}")

    for seat, item in detected.items():
        phone = expected.get(seat)
        if not phone:
            failures.append(f"decoded seat {seat} is not in the ground truth")
            continue
        dx = abs(item["gridX"] - phone["gridX"])
        dy = abs(item["gridY"] - phone["gridY"])
        if dx > 1.5 or dy > 1.5:
            failures.append(
                f"seat {seat}: position off by ({dx:.1f},{dy:.1f}) grid cells "
                f"(expected ({phone['gridX']},{phone['gridY']}), got ({item['gridX']},{item['gridY']}))"
            )

    stats = payload["stats"]
    print(
        f"\ndetected {stats['detected']}/{stats['candidates']} candidates · "
        f"{stats['corrected']} corrections · {stats['frames']} frames · {stats['processingSeconds']}s"
    )
    print(f"ground truth: {len(truth['phones'])} phones, {len(displaced)} displaced")
    if failures:
        print("\nFAIL")
        for failure in failures:
            print(f"  - {failure}")
        raise SystemExit(1)
    print("\nPASS: every displaced phone was detected, decoded and mapped back to its real seat.")


if __name__ == "__main__":
    main()
