#!/bin/bash
# Double-click to sync audio to video (macOS).
# Uses the Mac's own folder pickers, then shows progress in this window.
# First run sets up a private Python environment with everything it needs (~1 min).

cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
SUPPORT="$HOME/Library/Application Support/AudioSync"
ENV="$SUPPORT/venv"
mkdir -p "$SUPPORT"

alert() {  # alert "message" -> simple OK dialog
  osascript -e "display dialog \"$1\" buttons {\"OK\"} default button 1 with title \"Audio Sync\"" >/dev/null 2>&1
}

# ---------- 1. Python + packages (first run only) ----------
PY=""
for c in /Library/Frameworks/Python.framework/Versions/Current/bin/python3 \
         /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [ -x "$c" ] && "$c" -c "import venv" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  alert "Audio Sync needs Python (free, one-time install).\n\nThe download page will open now. Install it, then double-click Sync Audio again."
  open "https://www.python.org/downloads/macos/"
  exit 1
fi

if ! "$ENV/bin/python" -c "import numpy, imageio_ffmpeg" >/dev/null 2>&1; then
  echo "First-time setup: installing what Audio Sync needs. This takes about a minute..."
  rm -rf "$ENV"
  "$PY" -m venv "$ENV" &&
  "$ENV/bin/python" -m pip install --quiet --upgrade pip &&
  "$ENV/bin/python" -m pip install --quiet numpy imageio-ffmpeg &&
  "$ENV/bin/python" -c "import imageio_ffmpeg; imageio_ffmpeg.get_ffmpeg_exe()"
  if [ $? -ne 0 ]; then
    alert "Setup didn't finish. Check your internet connection and try again.\n\nDetails are in the Terminal window."
    exit 1
  fi
  echo "Setup complete."
fi

# ---------- 2. Pick folders with the normal Mac dialogs ----------
LAST="$(cat "$SUPPORT/last_folder" 2>/dev/null)"
[ -d "$LAST" ] || LAST="/Volumes"

pick() {  # pick "prompt" "start folder"  -> prints chosen POSIX path, empty if cancelled
  osascript -e "POSIX path of (choose folder with prompt \"$1\" default location (POSIX file \"$2\"))" 2>/dev/null
}

echo "Choose your video folder in the window that just opened..."
VIDEO="$(pick "Choose the folder for one shoot day (the one with A001, A002, SOUND inside)" "$LAST")"
[ -z "$VIDEO" ] && { echo "Cancelled."; exit 0; }
VIDEO="${VIDEO%/}"
echo "$VIDEO" > "$SUPPORT/last_folder"

ANSWER="$(osascript -e 'button returned of (display dialog "Is the audio inside that folder too? (for example in a SOUND folder next to A001, A002)" buttons {"No, choose audio folder", "Yes"} default button 2 with title "Audio Sync")' 2>/dev/null)"
[ -z "$ANSWER" ] && { echo "Cancelled."; exit 0; }
if [ "$ANSWER" = "Yes" ]; then
  AUDIO="$VIDEO"
else
  AUDIO="$(pick "Choose the folder with your AUDIO files" "$VIDEO")"
  [ -z "$AUDIO" ] && { echo "Cancelled."; exit 0; }
  AUDIO="${AUDIO%/}"
fi
OUT="$VIDEO/Synced"

# ---------- 3. Sync ----------
echo
echo "Videos:  $VIDEO"
echo "Audio:   $AUDIO"
echo "Save to: $OUT"
echo "Working... (keep this window open; you can minimize it)"
echo

LOG="$SUPPORT/last_run.log"
"$ENV/bin/python" -u "$HERE/avsync.py" "$VIDEO" "$AUDIO" "$OUT" -r --container mov 2>&1 | tee "$LOG"

SUMMARY="$(grep '^Finished:' "$LOG" | tail -1)"
if [ -z "$SUMMARY" ]; then
  if grep -q "Nothing to do" "$LOG"; then
    alert "Couldn't find both video clips and audio files in that folder.\n\nPick the folder that contains the camera folders and the SOUND folder."
  else
    alert "Something went wrong. The details are in the Terminal window - send a screenshot of it."
  fi
  exit 1
fi

CHOICE="$(osascript -e "button returned of (display dialog \"$SUMMARY\n\nAnything marked with ! in the Terminal window needs a look.\" buttons {\"Close\", \"Open Synced folder\"} default button 2 with title \"Audio Sync\")" 2>/dev/null)"
[ "$CHOICE" = "Open Synced folder" ] && open "$OUT"
exit 0
