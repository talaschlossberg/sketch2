#!/usr/bin/env python3
"""
avsync - sync external audio recordings to video clips by matching file names.

For every video whose name matches an audio file (e.g. A001.mov + A001.wav),
this script:

  1. Reads a small mono copy of the camera's scratch audio (no video decoding,
     nothing is copied to disk).
  2. Finds the time offset to the external audio with cross-correlation
     (GCC-PHAT), which is robust to the two recordings using different mics.
  3. Writes a merged file: the original video stream copied bit-for-bit
     (no re-encode), the external audio lined up underneath it, and
     optionally the original camera audio as a second track.

Everything runs locally; your footage never leaves the drive.

Requirements: Python 3.8+, numpy, and ffmpeg/ffprobe on your PATH.

Usage:
    python3 avsync.py VIDEO_DIR AUDIO_DIR OUTPUT_DIR [options]

Run with --help for all options.
"""

import argparse
import csv
import json
import shutil
import subprocess
import sys
from pathlib import Path

try:
    import numpy as np
except ImportError:
    sys.exit("numpy is required:  pip3 install numpy")

VIDEO_EXTS = {".mov", ".mp4", ".m4v", ".mxf", ".mts", ".m2ts", ".avi", ".mkv", ".mpg", ".mpeg"}
AUDIO_EXTS = {".wav", ".bwf", ".aif", ".aiff", ".flac", ".mp3", ".m4a", ".aac", ".ogg"}

ANALYSIS_RATE = 8000  # Hz. 1/8000 s precision is far finer than one video frame.


# --------------------------------------------------------------------------- #
# File discovery
# --------------------------------------------------------------------------- #

def find_media(folder: Path, exts: set, recursive: bool) -> dict:
    """Map lower-case file stem -> path. Skips macOS '._' resource-fork files."""
    pattern = "**/*" if recursive else "*"
    found = {}
    for p in sorted(folder.glob(pattern)):
        if not p.is_file() or p.name.startswith("._") or p.suffix.lower() not in exts:
            continue
        key = p.stem.lower()
        if key in found:
            print(f"  warning: two files named '{p.stem}' - using {found[key]}, ignoring {p}")
            continue
        found[key] = p
    return found


# --------------------------------------------------------------------------- #
# ffmpeg helpers
# --------------------------------------------------------------------------- #

def probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json",
         "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def has_audio(info: dict) -> bool:
    return any(s.get("codec_type") == "audio" for s in info.get("streams", []))


def duration_of(info: dict) -> float:
    d = info.get("format", {}).get("duration")
    if d is None:
        for s in info.get("streams", []):
            if s.get("codec_type") == "video" and s.get("duration"):
                d = s["duration"]
                break
    return float(d)


def load_audio(path: Path, max_seconds=None) -> np.ndarray:
    """Decode the first audio stream to mono float32 at ANALYSIS_RATE."""
    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path)]
    if max_seconds:
        cmd += ["-t", str(max_seconds)]
    cmd += ["-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(ANALYSIS_RATE),
            "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


# --------------------------------------------------------------------------- #
# Offset detection
# --------------------------------------------------------------------------- #

def find_offset(external: np.ndarray, camera: np.ndarray):
    """
    Return (offset_seconds, confidence).

    offset > 0: the external recorder was already running when the camera
                started; the first `offset` seconds of external audio are cut.
    offset < 0: the external recorder started after the camera; the external
                audio is delayed by |offset| seconds.

    confidence is the height of the best correlation peak divided by the next
    best peak elsewhere. ~1 means no clear match; a real match is usually > 3.
    """
    ext = external - external.mean()
    cam = camera - camera.mean()
    n = len(ext) + len(cam)
    nfft = 1 << (n - 1).bit_length()

    E = np.fft.rfft(ext, nfft)
    C = np.fft.rfft(cam, nfft)
    cross = E * np.conj(C)
    cross /= np.abs(cross) + 1e-12  # PHAT weighting: sharp peak, mic-independent
    corr = np.fft.irfft(cross, nfft)

    # Valid lags: -(len(cam)-1) .. len(ext)-1. Negative lags live at the end.
    lags = np.concatenate([np.arange(0, len(ext)), np.arange(-(len(cam) - 1), 0)])
    values = np.concatenate([corr[:len(ext)], corr[nfft - (len(cam) - 1):]])
    values = np.abs(values)

    best = int(np.argmax(values))
    peak = values[best]

    # Second-best peak at least 0.25 s away from the winner.
    guard = int(0.25 * ANALYSIS_RATE)
    masked = values.copy()
    masked[max(0, best - guard): best + guard + 1] = 0
    runner_up = masked.max() if masked.size else 0.0
    confidence = float(peak / runner_up) if runner_up > 0 else float("inf")

    return lags[best] / ANALYSIS_RATE, confidence


# --------------------------------------------------------------------------- #
# Merge
# --------------------------------------------------------------------------- #

def audio_codec_for(container: str):
    if container in (".mp4", ".m4v"):
        return ["-c:a", "aac", "-b:a", "320k"]
    return ["-c:a", "pcm_s24le"]  # lossless; fine in .mov / .mxf / .mkv


def merge(video: Path, audio: Path, out: Path, offset: float, video_dur: float,
          keep_camera_audio: bool, camera_has_audio: bool, overwrite: bool):
    if offset >= 0:
        shift = f"atrim=start={offset:.6f},asetpts=PTS-STARTPTS"
    else:
        shift = f"adelay=delays={round(-offset * 1000, 3)}:all=1"
    # Pad/trim so the new audio is exactly as long as the video.
    filt = f"[1:a:0]{shift},apad,atrim=end={video_dur:.6f}[ext]"

    cmd = ["ffmpeg", "-v", "error", "-stats", "-nostdin",
           "-y" if overwrite else "-n",
           "-i", str(video), "-i", str(audio),
           "-filter_complex", filt,
           "-map", "0:v:0", "-map", "[ext]"]
    if keep_camera_audio and camera_has_audio:
        cmd += ["-map", "0:a:0"]
    cmd += ["-c:v", "copy"] + audio_codec_for(out.suffix.lower())
    cmd += ["-map_metadata", "0", "-movflags", "+faststart",
            "-metadata:s:a:0", "title=External audio (synced)"]
    if keep_camera_audio and camera_has_audio:
        cmd += ["-metadata:s:a:1", "title=Camera audio"]
    cmd += [str(out)]
    subprocess.run(cmd, check=True)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():
    ap = argparse.ArgumentParser(
        description="Sync external audio to video clips with matching names.")
    ap.add_argument("video_dir", type=Path, help="folder with the video clips")
    ap.add_argument("audio_dir", type=Path, help="folder with the audio files (can be the same folder)")
    ap.add_argument("output_dir", type=Path, help="where the synced files go")
    ap.add_argument("--recursive", "-r", action="store_true",
                    help="also look inside subfolders")
    ap.add_argument("--container", choices=["same", "mov", "mp4", "mkv"], default="same",
                    help="output format. 'same' keeps each clip's extension "
                         "(mp4 gets AAC audio, everything else lossless PCM). Default: same")
    ap.add_argument("--analyze-seconds", type=float, default=300,
                    help="how much of each camera clip to listen to (default 300). "
                         "Only this part of the video file is read for analysis.")
    ap.add_argument("--min-confidence", type=float, default=2.5,
                    help="skip clips whose match is weaker than this (default 2.5)")
    ap.add_argument("--drop-camera-audio", action="store_true",
                    help="don't keep the camera's scratch audio as a second track")
    ap.add_argument("--dry-run", action="store_true",
                    help="only compute and report offsets, don't write video files")
    ap.add_argument("--overwrite", action="store_true",
                    help="replace existing output files")
    args = ap.parse_args()

    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            sys.exit(f"{tool} not found. Install ffmpeg (Mac: brew install ffmpeg, "
                     f"Windows: winget install ffmpeg) and try again.")

    videos = find_media(args.video_dir, VIDEO_EXTS, args.recursive)
    audios = find_media(args.audio_dir, AUDIO_EXTS, args.recursive)
    pairs = [(k, videos[k], audios[k]) for k in videos if k in audios]

    unmatched_v = sorted(videos.keys() - audios.keys())
    unmatched_a = sorted(audios.keys() - videos.keys())
    print(f"Found {len(videos)} videos, {len(audios)} audio files, {len(pairs)} matching pairs.")
    if unmatched_v:
        print(f"  videos with no audio: {', '.join(videos[k].name for k in unmatched_v)}")
    if unmatched_a:
        print(f"  audio with no video:  {', '.join(audios[k].name for k in unmatched_a)}")
    if not pairs:
        return 1

    args.output_dir.mkdir(parents=True, exist_ok=True)
    report_path = args.output_dir / "sync_report.csv"
    rows = []
    failures = 0

    for i, (_, video, audio) in enumerate(pairs, 1):
        print(f"\n[{i}/{len(pairs)}] {video.name}  <->  {audio.name}")
        row = {"video": str(video), "audio": str(audio), "offset_seconds": "",
               "confidence": "", "status": "", "output": ""}
        try:
            info = probe(video)
            if not has_audio(info):
                raise RuntimeError("video has no audio track to sync against")
            video_dur = duration_of(info)

            cam = load_audio(video, args.analyze_seconds)
            ext = load_audio(audio)
            if len(cam) < ANALYSIS_RATE or len(ext) < ANALYSIS_RATE:
                raise RuntimeError("audio shorter than 1 second")

            offset, conf = find_offset(ext, cam)
            row["offset_seconds"] = f"{offset:.4f}"
            row["confidence"] = f"{conf:.2f}"
            direction = ("recorder started earlier, trimming" if offset >= 0
                         else "recorder started later, delaying")
            print(f"  offset {offset:+.3f}s ({direction} {abs(offset):.3f}s), confidence {conf:.1f}")

            if conf < args.min_confidence:
                row["status"] = "skipped: low confidence"
                print(f"  ! low confidence (< {args.min_confidence}); skipped. "
                      "Check that these files really belong together.")
                failures += 1
            elif args.dry_run:
                row["status"] = "dry run"
            else:
                ext_name = video.suffix if args.container == "same" else "." + args.container
                out = args.output_dir / f"{video.stem}_synced{ext_name}"
                if out.exists() and not args.overwrite:
                    row["status"] = "skipped: output exists"
                    print(f"  {out.name} already exists (use --overwrite)")
                else:
                    merge(video, audio, out, offset, video_dur,
                          not args.drop_camera_audio, True, args.overwrite)
                    row["status"] = "ok"
                    row["output"] = str(out)
                    print(f"  wrote {out}")
        except subprocess.CalledProcessError as e:
            msg = (e.stderr.decode(errors="replace") if isinstance(e.stderr, bytes)
                   else (e.stderr or "")).strip().splitlines()
            row["status"] = "error: " + (msg[-1] if msg else "ffmpeg failed")
            print(f"  ! {row['status']}")
            failures += 1
        except Exception as e:  # keep going with the next clip
            row["status"] = f"error: {e}"
            print(f"  ! {row['status']}")
            failures += 1
        rows.append(row)

    with open(report_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    ok = sum(r["status"] in ("ok", "dry run") for r in rows)
    print(f"\nDone: {ok} synced, {failures} need attention. Report: {report_path}")
    return 0 if failures == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
