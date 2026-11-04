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

Easiest way to use it: double-click "Sync Audio" (Mac: Sync Audio.command,
Windows: Sync Audio.bat). That opens a window, see avsync_app.py.

Command line:
    python3 avsync.py VIDEO_DIR AUDIO_DIR OUTPUT_DIR [options]

Requirements: Python 3.8+, numpy, and ffmpeg (either the imageio-ffmpeg
package, which bundles it, or ffmpeg on your PATH).
"""

import argparse
import csv
import re
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

# Don't flash a console window for every ffmpeg call on Windows.
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


# --------------------------------------------------------------------------- #
# ffmpeg
# --------------------------------------------------------------------------- #

def ffmpeg_exe() -> str:
    """Prefer the ffmpeg bundled with imageio-ffmpeg, fall back to the PATH."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    raise RuntimeError("ffmpeg not found. Run:  pip3 install imageio-ffmpeg")


def _run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, creationflags=_NO_WINDOW, **kw)


def probe(ffmpeg: str, path: Path):
    """Return (duration_seconds, has_audio) by reading ffmpeg's file header dump."""
    err = _run([ffmpeg, "-hide_banner", "-nostdin", "-i", str(path)]).stderr.decode(errors="replace")
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", err)
    if not m:
        raise RuntimeError("could not read the file (is it a complete video?)")
    h, mi, s = m.groups()
    duration = int(h) * 3600 + int(mi) * 60 + float(s)
    has_audio = re.search(r"Stream #\S+.*: Audio:", err) is not None
    return duration, has_audio


def load_audio(ffmpeg: str, path: Path, max_seconds=None) -> np.ndarray:
    """Decode the first audio stream to mono float32 at ANALYSIS_RATE."""
    cmd = [ffmpeg, "-v", "error", "-nostdin", "-i", str(path)]
    if max_seconds:
        cmd += ["-t", str(max_seconds)]
    cmd += ["-map", "0:a:0", "-vn", "-ac", "1", "-ar", str(ANALYSIS_RATE), "-f", "f32le", "-"]
    p = _run(cmd)
    if p.returncode != 0:
        raise RuntimeError(_last_line(p.stderr) or f"could not read audio from {path.name}")
    return np.frombuffer(p.stdout, dtype=np.float32).astype(np.float64)


def _last_line(stderr: bytes) -> str:
    lines = stderr.decode(errors="replace").strip().splitlines()
    return lines[-1] if lines else ""


# --------------------------------------------------------------------------- #
# File discovery
# --------------------------------------------------------------------------- #

def find_media(folder: Path, exts: set, recursive: bool, skip_dir: Path = None, log=print) -> dict:
    """Map lower-case file stem -> path. Skips macOS '._' files and the output folder."""
    pattern = "**/*" if recursive else "*"
    skip = skip_dir.resolve() if skip_dir else None
    found = {}
    for p in sorted(folder.glob(pattern)):
        if not p.is_file() or p.name.startswith("._") or p.suffix.lower() not in exts:
            continue
        if skip and (skip == p.parent.resolve() or skip in p.resolve().parents):
            continue
        key = p.stem.lower()
        if key in found:
            log(f"  warning: two files named '{p.stem}' - using {found[key]}, ignoring {p}")
            continue
        found[key] = p
    return found


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
    values = np.abs(np.concatenate([corr[:len(ext)], corr[nfft - (len(cam) - 1):]]))

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


def merge(ffmpeg: str, video: Path, audio: Path, out: Path, offset: float,
          video_dur: float, keep_camera_audio: bool):
    if offset >= 0:
        shift = f"atrim=start={offset:.6f},asetpts=PTS-STARTPTS"
    else:
        shift = f"adelay=delays={round(-offset * 1000, 3)}:all=1"
    # Pad/trim so the new audio is exactly as long as the video.
    filt = f"[1:a:0]{shift},apad,atrim=end={video_dur:.6f}[ext]"

    cmd = [ffmpeg, "-v", "error", "-nostdin", "-y",
           "-i", str(video), "-i", str(audio),
           "-filter_complex", filt,
           "-map", "0:v:0", "-map", "[ext]"]
    if keep_camera_audio:
        cmd += ["-map", "0:a:0"]
    cmd += ["-c:v", "copy"] + audio_codec_for(out.suffix.lower())
    cmd += ["-map_metadata", "0", "-movflags", "+faststart",
            "-metadata:s:a:0", "title=External audio (synced)"]
    if keep_camera_audio:
        cmd += ["-metadata:s:a:1", "title=Camera audio"]

    # Write to a temp name first so an interrupted run never leaves a
    # half-written file that looks finished.
    tmp = out.with_name(out.stem + ".partial" + out.suffix)
    p = _run(cmd + [str(tmp)])
    if p.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(_last_line(p.stderr) or "ffmpeg failed while writing")
    tmp.replace(out)


# --------------------------------------------------------------------------- #
# The whole job
# --------------------------------------------------------------------------- #

def sync_folders(video_dir, audio_dir, output_dir, recursive=True, container="same",
                 analyze_seconds=300, min_confidence=2.5, keep_camera_audio=True,
                 dry_run=False, overwrite=False, log=print, progress=None,
                 should_stop=lambda: False):
    """
    Sync every matching pair. Returns (number_ok, number_needing_attention, report_path).
    `log(str)` receives human-readable lines; `progress(done, total)` is called per clip.
    """
    video_dir, audio_dir, output_dir = Path(video_dir), Path(audio_dir), Path(output_dir)
    ffmpeg = ffmpeg_exe()

    videos = find_media(video_dir, VIDEO_EXTS, recursive, output_dir, log)
    audios = find_media(audio_dir, AUDIO_EXTS, recursive, output_dir, log)
    pairs = [(videos[k], audios[k]) for k in videos if k in audios]

    log(f"Found {len(videos)} videos, {len(audios)} audio files, {len(pairs)} matching pairs.")
    unmatched_v = sorted(videos.keys() - audios.keys())
    unmatched_a = sorted(audios.keys() - videos.keys())
    if unmatched_v:
        log("  videos with no matching audio: " + ", ".join(videos[k].name for k in unmatched_v))
    if unmatched_a:
        log("  audio with no matching video: " + ", ".join(audios[k].name for k in unmatched_a))
    if not pairs:
        log("Nothing to do. Audio and video files need the same name, e.g. A001.mov and A001.wav.")
        return 0, 0, None

    output_dir.mkdir(parents=True, exist_ok=True)
    report_path = output_dir / "sync_report.csv"
    rows, ok, failures = [], 0, 0

    for i, (video, audio) in enumerate(pairs, 1):
        if should_stop():
            log("\nStopped.")
            break
        if progress:
            progress(i - 1, len(pairs))
        log(f"\n[{i}/{len(pairs)}] {video.name}  +  {audio.name}")
        row = {"video": str(video), "audio": str(audio), "offset_seconds": "",
               "confidence": "", "status": "", "output": ""}
        try:
            ext_name = video.suffix if container == "same" else "." + container
            out = output_dir / f"{video.stem}_synced{ext_name}"
            if out.exists() and not overwrite and not dry_run:
                row["status"] = "already done"
                row["output"] = str(out)
                log(f"  already done ({out.name})")
                ok += 1
                rows.append(row)
                continue

            video_dur, has_audio = probe(ffmpeg, video)
            if not has_audio:
                raise RuntimeError("this video has no sound on it, so there's nothing to sync against")

            cam = load_audio(ffmpeg, video, analyze_seconds)
            ext = load_audio(ffmpeg, audio)
            if len(cam) < ANALYSIS_RATE or len(ext) < ANALYSIS_RATE:
                raise RuntimeError("audio shorter than 1 second")

            offset, conf = find_offset(ext, cam)
            row["offset_seconds"] = f"{offset:.4f}"
            row["confidence"] = f"{conf:.2f}"
            direction = ("audio recorder started first, trimming" if offset >= 0
                         else "audio recorder started later, delaying")
            log(f"  offset {offset:+.3f}s ({direction} {abs(offset):.3f}s), match strength {conf:.1f}")

            if conf < min_confidence:
                row["status"] = "skipped: weak match"
                log("  ! weak match - skipped. Check that these two files really belong together.")
                failures += 1
            elif dry_run:
                row["status"] = "dry run"
                ok += 1
            else:
                log("  writing merged file...")
                merge(ffmpeg, video, audio, out, offset, video_dur, keep_camera_audio)
                row["status"] = "ok"
                row["output"] = str(out)
                log(f"  done -> {out.name}")
                ok += 1
        except Exception as e:  # keep going with the next clip
            row["status"] = f"error: {e}"
            log(f"  ! {e}")
            failures += 1
        rows.append(row)

    if progress:
        progress(len(pairs), len(pairs))
    if rows:
        with open(report_path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
    log(f"\nFinished: {ok} synced, {failures} need attention.")
    return ok, failures, report_path


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
                    help="how much of each camera clip to listen to (default 300)")
    ap.add_argument("--min-confidence", type=float, default=2.5,
                    help="skip clips whose match is weaker than this (default 2.5)")
    ap.add_argument("--drop-camera-audio", action="store_true",
                    help="don't keep the camera's scratch audio as a second track")
    ap.add_argument("--dry-run", action="store_true",
                    help="only compute and report offsets, don't write video files")
    ap.add_argument("--overwrite", action="store_true",
                    help="redo clips that already have a _synced file")
    a = ap.parse_args()

    ok, failures, report = sync_folders(
        a.video_dir, a.audio_dir, a.output_dir, recursive=a.recursive,
        container=a.container, analyze_seconds=a.analyze_seconds,
        min_confidence=a.min_confidence, keep_camera_audio=not a.drop_camera_audio,
        dry_run=a.dry_run, overwrite=a.overwrite)
    if report:
        print(f"Report: {report}")
    return 0 if failures == 0 and ok > 0 else (1 if ok == 0 and failures == 0 else 2)


if __name__ == "__main__":
    sys.exit(main())
