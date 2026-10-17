"""Turns the synthesised clips into labelled classifier windows (16 embeddings each).

Each clip is put in a scene: something before it (quiet, noise, or other speech), the
clip, something after it, then a phone-like microphone (level, band, room, noise).
Embeddings come from the same front end the app runs (front.py == engine.ts).

Labels, for a window of 16 embeddings ending at audio sample e:
  positive   the phrase ended at most 0.45 s before e (all of it is in the window)
  negative   every window of a negative clip; for a positive clip, windows ending
             more than 0.35 s before the phrase's end (so "hey niv" alone is not enough)
  ignored    the rest of a positive clip
"""
import sys, os, json, glob, zlib
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
sys.path.insert(0, os.path.dirname(__file__))
from front import load_front, mel, embed_windows
WORK = os.environ.get("WAKE_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "work"))

SR = 16000
WINDOW = 16
EMB_HOP = 1280          # samples between embeddings
EMB_SPAN = 12512        # samples of audio behind the first embedding (75 hops + 512)
MODELS = os.path.join(WORK, "models")
MELW, _ = load_front(os.path.join(MODELS, "melspectrogram.onnx"), os.path.join(MODELS, "embedding_model.onnx"))

def load(job):
    clips, meta = [], []
    for f in sorted(glob.glob(os.path.join(WORK, "data", f"{job}_*.npz"))):
        z = np.load(f, allow_pickle=True)
        clips += [a.astype(np.float32) for a in z["audio"]]
        meta += json.loads(str(z["meta"]))
    return clips, meta

def colored_noise(rng, n, kind):
    w = rng.standard_normal(n)
    if kind == "white": return w
    f = np.fft.rfft(w)
    k = np.arange(len(f)) + 1.0
    f /= np.sqrt(k) if kind == "pink" else k
    x = np.fft.irfft(f, n)
    return x / (np.std(x) + 1e-9)

def hum(rng, n):
    base = rng.choice([50, 60]); t = np.arange(n) / SR
    return sum(rng.uniform(0.2, 1) / h * np.sin(2 * np.pi * base * h * t + rng.uniform(0, 6)) for h in range(1, 8))

def rir(rng):
    rt60 = rng.uniform(0.15, 0.7)
    n = int(SR * rt60)
    t = np.arange(n) / SR
    h = rng.standard_normal(n) * np.exp(-6.9 * t / rt60)
    h[0] = rng.uniform(2, 6)  # direct sound
    return h / np.sqrt(np.sum(h ** 2))

def rms(x): return np.sqrt(np.mean(x ** 2) + 1e-12)
LEVEL = 0.05

class Scene:
    def __init__(self, rng, speech_pool):
        self.rng = rng
        self.pool = speech_pool

    def other_speech(self, n):
        """n samples of other people talking."""
        out = []
        while sum(len(o) for o in out) < n:
            c = self.pool[self.rng.integers(len(self.pool))]
            out.append(c / (rms(c) + 1e-9) * LEVEL)
            out.append(np.zeros(int(self.rng.uniform(0.05, 0.5) * SR)))
        return np.concatenate(out)[:n]

    def background(self, n):
        r = self.rng.random()
        if r < 0.25: return colored_noise(self.rng, n, self.rng.choice(["white", "pink", "brown"]))
        if r < 0.35: return hum(self.rng, n)
        if r < 0.6:  # babble: several voices at once
            b = sum(self.other_speech(n) for _ in range(self.rng.integers(3, 7)))
            return b / (rms(b) + 1e-9)
        if r < 0.7:  # music-like: a few held notes
            t = np.arange(n) / SR
            return sum(np.sin(2 * np.pi * self.rng.uniform(110, 880) * t) * (np.sin(2 * np.pi * self.rng.uniform(0.2, 2) * t) > 0) for _ in range(4))
        return None

    def mic(self, x, noise_only=False):
        """Room, band, level and background, as a phone would hear it."""
        rng = self.rng
        if noise_only:
            x = sosfilt(butter(2, [rng.uniform(80, 300), rng.uniform(3600, 7600)], btype="band", fs=SR, output="sos"), x)
            x = x / (rms(x) + 1e-9) * 10 ** (rng.uniform(-60, -18) / 20)
            return np.clip(x + rng.standard_normal(len(x)) * 10 ** (rng.uniform(-75, -55) / 20), -1, 1)
        if rng.random() < 0.5: x = fftconvolve(x, rir(rng))[: len(x)]
        lo = rng.uniform(80, 300); hi = rng.uniform(3600, 7600)
        x = sosfilt(butter(2, [lo, hi], btype="band", fs=SR, output="sos"), x)
        x = x / (rms(x) + 1e-9) * 10 ** (rng.uniform(-38, -16) / 20)
        bg = self.background(len(x)) if rng.random() < 0.75 else None
        if bg is not None:
            snr = rng.uniform(3, 30)
            x = x + bg / (rms(bg) + 1e-9) * rms(x) / 10 ** (snr / 20)
        x = x + rng.standard_normal(len(x)) * 10 ** (rng.uniform(-75, -55) / 20)  # the microphone's own hiss
        return np.clip(x, -1, 1)

    def place(self, clip, before_s, after_s, speech_after=False, speech_before=None):
        rng = self.rng
        sb = rng.random() < 0.35 if speech_before is None else speech_before
        pre = self.other_speech(int(before_s * SR)) * rng.uniform(0.3, 1.0) if sb else np.zeros(int(before_s * SR))
        if sb:  # a short pause before the phrase
            pre = np.concatenate([pre, np.zeros(int(rng.uniform(0.15, 0.6) * SR))])
        post = self.other_speech(int(after_s * SR)) if speech_after else np.zeros(int(after_s * SR))
        if speech_after: post = np.concatenate([np.zeros(int(rng.uniform(0.05, 0.4) * SR)), post])
        audio = np.concatenate([pre, clip / (rms(clip) + 1e-9) * LEVEL, post])
        return audio, len(pre), len(pre) + len(clip)

def windows(audio):
    pcm = np.round(audio * 32767)
    E = embed_windows(mel(pcm, MELW), os.path.join(MODELS, "embedding_model.onnx"))
    if len(E) < WINDOW: return np.zeros((0, WINDOW, 96), np.float16), np.zeros(0, np.int64)
    idx = np.arange(WINDOW)[None] + np.arange(len(E) - WINDOW + 1)[:, None]
    ends = (np.arange(WINDOW - 1, len(E)) * EMB_HOP + EMB_SPAN)
    return E[idx].astype(np.float16), ends

# Windows ending up to this long after the phrase count as hearing it: long enough for a few in a row.
POS_AFTER = 0.45

def build(kind, clips, seed, reps=1, max_neg_per_clip=None, pool="speech_train", skip_pos=None):
    """skip_pos: clips whose phrase is not a wake (e.g. "Hey Neev Pay"): their windows give only negatives."""
    rng = np.random.default_rng(seed)
    skip_pos = skip_pos if skip_pos is not None else np.zeros(len(clips), bool)
    scene = Scene(rng, load(pool)[0][:500])
    X, y, src = [], [], []
    for ci, clip in enumerate(clips):
        for r in range(reps):
            before = rng.uniform(1.6, 2.6)
            if kind == "pos":
                audio, s0, s1 = scene.place(clip, before, rng.uniform(0.4, 1.2), speech_after=rng.random() < 0.4)
            elif kind == "noise":
                audio, s0, s1 = scene.mic(clip + 1e-6 * rng.standard_normal(len(clip)), noise_only=True), 0, len(clip)
            else:
                audio, s0, s1 = scene.place(clip, before, rng.uniform(0.3, 1.0), speech_after=rng.random() < 0.3)
            if kind != "noise": audio = scene.mic(audio)
            W, ends = windows(audio)
            if kind == "pos":
                lab = np.full(len(ends), -1)
                if not skip_pos[ci]:
                    lab[(ends >= s1) & (ends <= s1 + int(POS_AFTER * SR))] = 1
                lab[ends < s1 - int(0.35 * SR)] = 0
                keep = lab >= 0
            else:
                lab = np.zeros(len(ends), int); keep = np.ones(len(ends), bool)
                if max_neg_per_clip and keep.sum() > max_neg_per_clip:
                    sel = rng.choice(np.nonzero(keep)[0], max_neg_per_clip, replace=False)
                    keep[:] = False; keep[sel] = True
            X.append(W[keep]); y.append(lab[keep]); src.append(np.full(keep.sum(), ci))
        if ci % 200 == 0: print(kind, ci, len(clips), flush=True)
    return np.concatenate(X), np.concatenate(y).astype(np.int8), np.concatenate(src)

if __name__ == "__main__":
    job, kind, reps, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
    pool = "speech_test" if job.endswith("_test") else "speech_train"
    if kind == "noise":
        rng = np.random.default_rng(zlib.crc32(out.encode()))
        sc = Scene(rng, load(pool)[0][:500])
        clips = []
        for _ in range(int(job.split("_")[0])):
            n = int(rng.uniform(3, 8) * SR)
            b = sc.background(n)
            clips.append(np.zeros(n) if b is None else b)
    else:
        clips, meta = load(job)
    if os.environ.get("SHARD"):  # "i/n": every n-th clip from the i-th, to spread one job over cores
        i, n = map(int, os.environ["SHARD"].split("/"))
        clips, meta = clips[i::n], meta[i::n]
    # "Hey Neev Pay" is too close to "hey, need pay" to be a wake: never a positive.
    skip = np.array(["iːv" in m["text"] for m in meta]) if kind == "pos" else None
    X, y, src = build(kind, clips, zlib.crc32(out.encode()), reps, pool=pool, skip_pos=skip)
    np.savez(out, X=X, y=y, src=src)
    print(out, X.shape, np.bincount(y.astype(np.int64) + 0))
