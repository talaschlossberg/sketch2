@echo off
rem Double-click to open Audio Sync (Windows).
rem First run sets up a private Python environment with everything it needs (~1 min).
setlocal
cd /d "%~dp0"
set "ENV=%LOCALAPPDATA%\AudioSync\venv"

if exist "%ENV%\Scripts\pythonw.exe" (
  "%ENV%\Scripts\python.exe" -c "import numpy, imageio_ffmpeg" >nul 2>&1 && goto run
)

set "PY="
where py >nul 2>&1 && py -3 -c "import tkinter, venv" >nul 2>&1 && set "PY=py -3"
if not defined PY (
  python -c "import tkinter, venv" >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo Python is needed. Trying to install it automatically...
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
  echo.
  echo If Python installed, close this window and double-click "Sync Audio" again.
  echo If not, install Python from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^).
  start "" "https://www.python.org/downloads/windows/"
  pause
  exit /b 1
)

echo First-time setup: installing what Audio Sync needs. This takes about a minute...
if exist "%ENV%" rmdir /s /q "%ENV%"
%PY% -m venv "%ENV%" || goto fail
"%ENV%\Scripts\python.exe" -m pip install --quiet --upgrade pip
"%ENV%\Scripts\python.exe" -m pip install --quiet numpy imageio-ffmpeg || goto fail
"%ENV%\Scripts\python.exe" -c "import imageio_ffmpeg; imageio_ffmpeg.get_ffmpeg_exe()" || goto fail
echo Setup complete.

:run
start "" "%ENV%\Scripts\pythonw.exe" "%~dp0avsync_app.py"
exit /b 0

:fail
echo.
echo Setup did not finish. Check your internet connection and try again.
pause
exit /b 1
