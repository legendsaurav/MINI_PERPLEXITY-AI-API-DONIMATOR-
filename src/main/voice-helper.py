import sys
import os
import json
import queue
import argparse
import threading
import urllib.request
import urllib.parse
from dataclasses import dataclass

# Try importing dependencies. If fail, log and exit.
try:
    import numpy as np
    import sounddevice as sd
    from pynput import keyboard
    from vosk import Model, KaldiRecognizer
except ImportError as e:
    print(f"[VOICE-HELPER] ImportError: {e}. Make sure requirements are installed in the venv.")
    sys.exit(1)

@dataclass
class VoiceHelperConfig:
    model_dir: str
    port: int = 9876
    sample_rate: int = 16000

class VoiceHelperService:
    def __init__(self, config: VoiceHelperConfig):
        self.config = config
        self.port = config.port
        self.model_dir = config.model_dir
        self.sample_rate = config.sample_rate

        print(f"[VOICE-HELPER] Loading Vosk model from: {self.model_dir}...")
        self.model = Model(self.model_dir)
        print("[VOICE-HELPER] Vosk model loaded successfully.")

        self.recording = False
        self.audio_queue = queue.Queue()
        self.lock = threading.Lock()

        self.ctrl_down = False
        self.alt_down = False

        # Start pynput keyboard listener
        self.listener = keyboard.Listener(on_press=self._on_press, on_release=self._on_release)

    def start(self):
        self.listener.start()
        print("[VOICE-HELPER] Global keyboard listener started (Ctrl+Alt to Record).")
        # Keep the main thread alive
        self.listener.join()

    def _send_state_update(self, endpoint, data=None):
        url = f"http://127.0.0.1:{self.port}{endpoint}"
        try:
            if data is not None:
                encoded_data = urllib.parse.urlencode(data).encode("utf-8")
                req = urllib.request.Request(url, data=encoded_data, method="POST")
            else:
                req = urllib.request.Request(url, method="POST")
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.read().decode("utf-8")
        except Exception as e:
            print(f"[VOICE-HELPER] Failed to notify Electron at {url}: {e}")
            return None

    def _on_press(self, key):
        if key in (keyboard.Key.ctrl_l, keyboard.Key.ctrl_r):
            self.ctrl_down = True
        if key in (keyboard.Key.alt_l, keyboard.Key.alt_r, keyboard.Key.alt_gr):
            self.alt_down = True

        if self.ctrl_down and self.alt_down:
            with self.lock:
                if not self.recording:
                    self.recording = True
                    print("[VOICE-HELPER] PTT Pressed! Starting voice capture...")
                    # Notify Electron that user is listening
                    threading.Thread(target=self._send_state_update, args=("/voice/pressed",)).start()
                    # Start recording thread
                    threading.Thread(target=self._record_audio_loop).start()

    def _on_release(self, key):
        if key in (keyboard.Key.ctrl_l, keyboard.Key.ctrl_r):
            self.ctrl_down = False
        if key in (keyboard.Key.alt_l, keyboard.Key.alt_r, keyboard.Key.alt_gr):
            self.alt_down = False

        # Stop recording if either modifier key is released
        if self.recording and (not (self.ctrl_down and self.alt_down)):
            with self.lock:
                if self.recording:
                    self.recording = False
                    print("[VOICE-HELPER] PTT Released! Stopping voice capture...")
                    # Notify Electron that user has released
                    threading.Thread(target=self._send_state_update, args=("/voice/released",)).start()

    def _record_audio_loop(self):
        recognizer = KaldiRecognizer(self.model, self.sample_rate)
        self.audio_queue = queue.Queue()

        def on_audio_callback(indata, frames, time, status):
            if status:
                return
            # Convert float32 input to 16-bit PCM bytes
            pcm16 = (indata[:, 0] * 32767.0).astype(np.int16).tobytes()
            self.audio_queue.put(pcm16)

        try:
            with sd.InputStream(
                samplerate=self.sample_rate,
                channels=1,
                dtype="float32",
                callback=on_audio_callback
            ):
                while True:
                    with self.lock:
                        if not self.recording:
                            break
                    try:
                        chunk = self.audio_queue.get(timeout=0.1)
                    except queue.Empty:
                        continue
                    recognizer.AcceptWaveform(chunk)
        except Exception as e:
            print(f"[VOICE-HELPER] Audio stream error: {e}")
            with self.lock:
                self.recording = False
            return

        # Perform final transcription
        final_json = recognizer.FinalResult()
        try:
            payload = json.loads(final_json)
            text = payload.get("text", "").strip()
        except json.JSONDecodeError:
            text = ""

        print(f"[VOICE-HELPER] Transcription completed: '{text}'")
        # Send result to Electron
        self._send_state_update("/voice/transcribed", {"q": text})

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Voice Helper subprocess for Desktop AI Copilot")
    parser.add_argument("--model-dir", required=True, help="Path to Vosk model directory")
    parser.add_argument("--port", type=int, default=9876, help="Electron HTTP server port")
    args = parser.parse_args()

    service = VoiceHelperService(VoiceHelperConfig(model_dir=args.model_dir, port=args.port))
    service.start()
