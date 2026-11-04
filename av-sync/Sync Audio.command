#!/bin/bash
# Double-click to open Audio Sync (macOS).
# First run sets up a private Python environment with everything it needs (~1 min).

cd "$(dirname "$0")" || exit 1
ENV="$HOME/Library/Application Support/AudioSync/venv"

say_error() {
  osascript -e "display dialog \"$1\" buttons {\"OK\"} default button 1 with title \"Audio Sync\" with icon caution" >/dev/null 2>&1
}

# Find a Python 3 that has the window toolkit (tkinter). python.org's installer is preferred.
PY=""
for c in /Library/Frameworks/Python.framework/Versions/Current/bin/python3 \
         /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [ -x "$c" ] && "$c" -c "import tkinter, venv" >/dev/null 2>&1; then PY="$c"; break; fi
done

if [ -z "$PY" ]; then
  echo "Python 3 is needed. Opening the download page..."
  say_error "Audio Sync needs Python (free, one-time install).\n\nThe download page will open now. Install it, then double-click Sync Audio again."
  open "https://www.python.org/downloads/macos/"
  exit 1
fi

if [ ! -x "$ENV/bin/python" ] || ! "$ENV/bin/python" -c "import numpy, imageio_ffmpeg" >/dev/null 2>&1; then
  echo "First-time setup: installing what Audio Sync needs. This takes about a minute..."
  rm -rf "$ENV"
  mkdir -p "$(dirname "$ENV")"
  "$PY" -m venv "$ENV" &&
  "$ENV/bin/python" -m pip install --quiet --upgrade pip &&
  "$ENV/bin/python" -m pip install --quiet numpy imageio-ffmpeg &&
  "$ENV/bin/python" -c "import imageio_ffmpeg; imageio_ffmpeg.get_ffmpeg_exe()"
  if [ $? -ne 0 ]; then
    say_error "Setup didn't finish. Check your internet connection and try again.\n\nDetails are in the Terminal window."
    exit 1
  fi
  echo "Setup complete."
fi

echo "Opening Audio Sync... (you can leave this Terminal window alone; closing it closes the app)"
exec "$ENV/bin/python" avsync_app.py
