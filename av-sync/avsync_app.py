#!/usr/bin/env python3
"""
Audio Sync - a small window around avsync.py.

Pick the folder with your videos (and audio, if it's somewhere else),
press Sync, and the merged files appear in a "Synced" folder.
"""

import json
import os
import queue
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import avsync

SETTINGS = Path.home() / ".avsync_settings.json"


def load_settings():
    try:
        return json.loads(SETTINGS.read_text())
    except Exception:
        return {}


def save_settings(d):
    try:
        SETTINGS.write_text(json.dumps(d, indent=2))
    except Exception:
        pass


def open_folder(path):
    path = str(path)
    if sys.platform == "darwin":
        subprocess.Popen(["open", path])
    elif os.name == "nt":
        os.startfile(path)
    else:
        subprocess.Popen(["xdg-open", path])


class App:
    def __init__(self, root):
        self.root = root
        self.msgs = queue.Queue()
        self.worker = None
        self.stop_requested = False
        s = load_settings()

        root.title("Audio Sync")
        root.minsize(620, 520)
        pad = {"padx": 10, "pady": 4}

        frm = ttk.Frame(root, padding=12)
        frm.pack(fill="both", expand=True)
        frm.columnconfigure(1, weight=1)

        ttk.Label(frm, text="Sync audio to video", font=("", 16, "bold")).grid(
            row=0, column=0, columnspan=3, sticky="w", pady=(0, 2))
        ttk.Label(frm, text="Clips are matched to audio by name, or by listening when names differ.",
                  foreground="gray").grid(row=1, column=0, columnspan=3, sticky="w", pady=(0, 10))

        self.video_var = tk.StringVar(value=s.get("video", ""))
        self.audio_var = tk.StringVar(value=s.get("audio", ""))
        self.out_var = tk.StringVar(value=s.get("out", ""))

        self._folder_row(frm, 2, "1. Video folder", self.video_var, self._pick_video)
        self._folder_row(frm, 3, "2. Audio folder", self.audio_var, self._pick_audio)
        self._folder_row(frm, 4, "3. Save to", self.out_var, self._pick_out)

        opts = ttk.Frame(frm)
        opts.grid(row=5, column=0, columnspan=3, sticky="w", pady=(8, 4))
        self.recursive_var = tk.BooleanVar(value=s.get("recursive", True))
        self.mov_var = tk.BooleanVar(value=s.get("mov", True))
        self.keep_cam_var = tk.BooleanVar(value=s.get("keep_cam", True))
        ttk.Checkbutton(opts, text="Look in subfolders too", variable=self.recursive_var).pack(anchor="w")
        ttk.Checkbutton(opts, text="Save as .mov with lossless audio (best for Premiere)",
                        variable=self.mov_var).pack(anchor="w")
        ttk.Checkbutton(opts, text="Keep the camera's own sound as a second track",
                        variable=self.keep_cam_var).pack(anchor="w")

        btns = ttk.Frame(frm)
        btns.grid(row=6, column=0, columnspan=3, sticky="we", pady=(8, 6))
        self.sync_btn = ttk.Button(btns, text="Sync", command=self.start)
        self.sync_btn.pack(side="left")
        self.stop_btn = ttk.Button(btns, text="Stop", command=self.stop, state="disabled")
        self.stop_btn.pack(side="left", padx=6)
        self.open_btn = ttk.Button(btns, text="Open synced folder", command=self.open_output,
                                   state="disabled")
        self.open_btn.pack(side="right")

        self.bar = ttk.Progressbar(frm, mode="determinate")
        self.bar.grid(row=7, column=0, columnspan=3, sticky="we", pady=(0, 6))

        logf = ttk.Frame(frm)
        logf.grid(row=8, column=0, columnspan=3, sticky="nsew")
        frm.rowconfigure(8, weight=1)
        self.log = tk.Text(logf, height=14, wrap="word", state="disabled")
        sb = ttk.Scrollbar(logf, command=self.log.yview)
        self.log["yscrollcommand"] = sb.set
        self.log.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

        self._write("1. Choose your video folder.\n"
                    "2. Audio folder: leave empty if the audio is in the same folder.\n"
                    "3. Save to: leave empty to make a 'Synced' folder inside the video folder.\n"
                    "Then press Sync.\n\n"
                    "Your original files are never changed; new files are written next to them.\n")
        root.after(100, self._drain)

    # ---------------- UI helpers ----------------

    def _folder_row(self, frm, row, label, var, cmd):
        ttk.Label(frm, text=label).grid(row=row, column=0, sticky="w", padx=(0, 8), pady=3)
        ttk.Entry(frm, textvariable=var).grid(row=row, column=1, sticky="we", pady=3)
        ttk.Button(frm, text="Choose...", command=cmd).grid(row=row, column=2, padx=(6, 0), pady=3)

    def _ask(self, title, current):
        start = current or self.video_var.get() or str(Path.home())
        return filedialog.askdirectory(title=title, initialdir=start if Path(start).exists() else None)

    def _pick_video(self):
        d = self._ask("Choose the folder with your videos", self.video_var.get())
        if d:
            self.video_var.set(d)

    def _pick_audio(self):
        d = self._ask("Choose the folder with your audio files", self.audio_var.get())
        if d:
            self.audio_var.set(d)

    def _pick_out(self):
        d = self._ask("Choose where to save the synced files", self.out_var.get())
        if d:
            self.out_var.set(d)

    def _write(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text)
        self.log.see("end")
        self.log.configure(state="disabled")

    def _drain(self):
        try:
            while True:
                kind, val = self.msgs.get_nowait()
                if kind == "log":
                    self._write(val + "\n")
                elif kind == "progress":
                    done, total = val
                    self.bar["maximum"] = max(total, 1)
                    self.bar["value"] = done
                elif kind == "done":
                    self._finished(*val)
        except queue.Empty:
            pass
        self.root.after(100, self._drain)

    # ---------------- run ----------------

    def _paths(self):
        video = self.video_var.get().strip()
        audio = self.audio_var.get().strip() or video
        out = self.out_var.get().strip() or (str(Path(video) / "Synced") if video else "")
        return video, audio, out

    def start(self):
        video, audio, out = self._paths()
        if not video or not Path(video).is_dir():
            messagebox.showwarning("Audio Sync", "Please choose the folder with your videos first.")
            return
        if not Path(audio).is_dir():
            messagebox.showwarning("Audio Sync", "The audio folder can't be found.")
            return

        save_settings({"video": self.video_var.get(), "audio": self.audio_var.get(),
                       "out": self.out_var.get(), "recursive": self.recursive_var.get(),
                       "mov": self.mov_var.get(), "keep_cam": self.keep_cam_var.get()})

        self.out_path = Path(out)
        self.stop_requested = False
        self.sync_btn.configure(state="disabled")
        self.stop_btn.configure(state="normal")
        self.open_btn.configure(state="disabled")
        self.bar["value"] = 0
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")
        self._write(f"Videos:  {video}\nAudio:   {audio}\nSave to: {out}\n\n")

        kwargs = dict(recursive=self.recursive_var.get(),
                      container="mov" if self.mov_var.get() else "same",
                      keep_camera_audio=self.keep_cam_var.get())

        def work():
            try:
                ok, bad, report = avsync.sync_folders(
                    video, audio, out, **kwargs,
                    log=lambda t: self.msgs.put(("log", t)),
                    progress=lambda d, t: self.msgs.put(("progress", (d, t))),
                    should_stop=lambda: self.stop_requested)
                self.msgs.put(("done", (ok, bad, None)))
            except Exception as e:
                self.msgs.put(("log", f"\nSomething went wrong: {e}"))
                self.msgs.put(("done", (0, 0, str(e))))

        self.worker = threading.Thread(target=work, daemon=True)
        self.worker.start()

    def stop(self):
        self.stop_requested = True
        self.stop_btn.configure(state="disabled")
        self._write("\nStopping after the current clip...\n")

    def _finished(self, ok, bad, error):
        self.sync_btn.configure(state="normal")
        self.stop_btn.configure(state="disabled")
        if self.out_path.exists():
            self.open_btn.configure(state="normal")
        if error:
            messagebox.showerror("Audio Sync", f"Something went wrong:\n\n{error}")
        elif ok == 0 and bad == 0:
            messagebox.showinfo("Audio Sync", "Couldn't find both video clips and audio files "
                                "in the chosen folders.")
        elif bad:
            messagebox.showwarning("Audio Sync", f"{ok} clip(s) synced.\n{bad} clip(s) need a look "
                                   "- see the messages marked with '!' in the window.")
        else:
            messagebox.showinfo("Audio Sync", f"All done! {ok} clip(s) synced.")

    def open_output(self):
        open_folder(self.out_path)


def main():
    root = tk.Tk()
    try:
        ttk.Style().theme_use("aqua" if sys.platform == "darwin" else
                              "vista" if os.name == "nt" else "clam")
    except tk.TclError:
        pass
    App(root)
    # Come to the front instead of opening behind the Terminal window.
    root.lift()
    root.attributes("-topmost", True)
    root.after(600, lambda: root.attributes("-topmost", False))
    root.focus_force()
    root.mainloop()


if __name__ == "__main__":
    main()
