# Audio Sync

Lines up your separately recorded audio with your video clips and saves new, merged video files. It runs on your own computer, straight off your external drive, so nothing gets uploaded.

It works out which audio file goes with which clip by itself: by matching names when they match (`A001.mov` + `A001.wav`), otherwise by **listening** to both. So a card layout like this just works:

```
2026-10-14/
  A001/   C0001.MP4  C0002.MP4 ...
  A002/   C0001.MP4  ...
  SOUND/  251014_001.WAV  251014_002.WAV ...
```

Pick `2026-10-14` and you get `2026-10-14/Synced/A001/C0001_synced.mov` and so on. One long recording can cover several clips. Sony proxy files (`M4ROOT/SUB`) are ignored.

## How to use it

### First time only

1. Unzip the `av-sync` folder anywhere (Desktop is fine).
2. **Mac:** double-click **`Sync Audio.command`**.
   **Windows:** double-click **`Sync Audio.bat`**.
3. If your Mac says it **can't verify the developer**: click **Done**, open **System Settings → Privacy & Security**, scroll down, click **Open Anyway** next to "Sync Audio.command", and confirm. You only do this once.
   (On Windows, if a blue "Windows protected your PC" box appears, click **More info → Run anyway**.)
4. If you don't have Python, it opens the download page for you. Install it, then double-click **Sync Audio** again.
5. The first launch spends about a minute installing what it needs. After that it opens straight away.

### Every time (Mac)

1. Double-click **Sync Audio.command**.
2. A folder picker opens. Choose the shoot-day folder on your external drive (the one with the camera folders and SOUND inside).
3. It asks whether the audio is inside that folder too. Click **Yes**, or **No** and choose the audio folder.
4. Progress shows in the Terminal window (keep it open; minimizing is fine).
5. When it's done, click **Open Synced folder**. The new files are in a `Synced` folder inside your video folder.

If macOS asks whether Terminal may access files on a removable volume, click **Allow**.

### Every time (Windows)

1. Double-click **Sync Audio.bat**. A window opens.
2. **Video folder → Choose...** and pick the folder with the clips. Leave **Audio folder** empty if the audio is in the same folder. Leave **Save to** empty for a `Synced` folder inside it.
3. Press **Sync**. When it says *All done*, click **Open synced folder**.

Either way, clips that are already done are skipped, so after adding new footage you can simply run it again.

## What you get

`A001_synced.mov` for each clip:
- the **original video, untouched** (copied, not re-encoded, so no quality loss, and it's fast),
- **audio track 1:** your external audio, lined up and trimmed to the clip,
- **audio track 2:** the camera's own sound (untick the box if you don't want it).

Your original files are never changed. Each merged file is about the same size as the original, so make sure the drive has room.

There is also a `sync_report.csv` with the offset found for every clip.

## If a clip says "weak match"

Or "no audio file matched this clip". The program couldn't hear the same sound on the clip and any audio file, so it skipped the clip rather than guess. Usually this means:
- there's no recording for that clip (e.g. the recorder wasn't running), or
- the camera's sound is silent or very quiet.

## Good to know

- The audio recorder can start before or after the camera. Both cases work.
- Every clip needs *some* sound recorded on the camera, because that's what the program listens to.
- On very long takes (30+ minutes) the camera and recorder clocks can drift apart by about a frame. Spot-check the end of your longest clips.

## Command line (optional)

```bash
python3 avsync.py VIDEO_FOLDER AUDIO_FOLDER OUTPUT_FOLDER -r --container mov
```

Add `--dry-run` to only print the offsets, or `--help` to list every option.
