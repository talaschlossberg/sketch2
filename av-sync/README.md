# avsync

Automatically sync separately recorded audio to video clips, then write merged files. It runs on your own computer against the drive the footage is on, so nothing is uploaded.

Files are paired by name: `A001.mov` goes with `A001.wav`. Case doesn't matter, and the audio can be in a different folder or the same one.

## What it does to each pair

1. Listens to the camera's scratch audio (by default the first 5 minutes). Only audio is read; video is never decoded.
2. Finds the offset to the external recording by cross-correlation.
3. Writes `<name>_synced.<ext>` with:
   - the **original video stream copied untouched** (no re-encode, no quality loss, fast),
   - **track 1:** the external audio, trimmed or delayed so it lines up and is exactly as long as the clip,
   - **track 2:** the original camera audio (use `--drop-camera-audio` to leave it out).
4. Writes `sync_report.csv` with each clip's offset, confidence and result.

Clips whose match is weak (wrong file pairing, no shared sound, a silent camera track) are **skipped and listed** rather than merged badly.

## Setup (once)

**Mac**
```bash
brew install ffmpeg
```
```bash
pip3 install numpy
```

**Windows**
```bash
winget install ffmpeg
```
```bash
pip install numpy
```

## Run

Try a dry run first. It only prints the offsets:

```bash
python3 avsync.py "/Volumes/MyDrive/Footage" "/Volumes/MyDrive/Audio" "/Volumes/MyDrive/Synced" --dry-run
```

Then do it for real:

```bash
python3 avsync.py "/Volumes/MyDrive/Footage" "/Volumes/MyDrive/Audio" "/Volumes/MyDrive/Synced"
```

On Windows the paths look like `"E:\Footage"`.

Write the output to the same external drive. That way the merged files are written alongside the originals instead of being copied across drives.

### Options

| Option | What it does |
| --- | --- |
| `-r`, `--recursive` | Also search subfolders (e.g. card folders like `CARD01/`). |
| `--container mov` | Output format. The default `same` keeps each clip's extension. `.mp4` outputs get AAC 320k audio; everything else gets lossless 24-bit PCM. `mov` is the best choice for Premiere if you want lossless audio from mp4 sources. |
| `--analyze-seconds 300` | How much of each camera clip to listen to. Raise it if a clip starts with a long silence. |
| `--min-confidence 2.5` | Matches weaker than this are skipped. A real match is usually 10 or higher. |
| `--drop-camera-audio` | Only keep the synced external audio. |
| `--overwrite` | Replace existing `_synced` files (otherwise they're skipped, so you can safely re-run after adding more clips). |

## Notes

- The external recording can start before or after the camera; both cases are handled.
- **Drift:** the script finds one offset per clip. Very long takes (30+ minutes) on cameras and recorders with unlocked clocks can slowly drift apart by a frame or so. Check the end of your longest clips.
- Each clip needs *some* audio on the camera for this to work.
- Disk space: each merged file is about the same size as the original video.
