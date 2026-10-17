"""Recorded audio for the tests, from voices the model never trained on (gen.py TEST_VOICES).

Usage: make_audio.py <classifier.npz> <testdata dir> <browser dir>

  testdata (engine.test.ts, a few seconds each, committed):
    hey-nivpay.wav   "Hey NivPay" in an everyday room, and reference.json: what
                     openWakeWord's front end in Python and the classifier make of it
    similar.wav      words like it: "navy pay", "NivPay" alone, "hey Siri", "hey Niv"...
    talk.wav         ordinary sentences
  browser (browser-check.mjs, longer, played as Chromium's microphone on a loop):
    wake.wav, similar.wav, talk.wav, and close.wav: the closest phrases, which sometimes wake it
"""
import sys, os, json
import numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(__file__))
import features as F
from evaluate import scores

# Words like "Hey NivPay" that the evaluation never saw wake it (evaluate.py, 8 tries each): the
# tests expect none of these to wake it.
SIMILAR = ["navy pay", "NivPay", "I use NivPay", "hey Siri", "hey PayPal", "hey Niv", "hey Nick", "hey Kev, pay",
           "hey, Nick paid", "hey Nev, pay", "hey Liv", "hey Nikki, pay", "hey Zelle", "heavy pay", "hey Google",
           "my NivPay account", "hey, did you pay", "hey there", "happy payday"]
# The closest ones, which sometimes do. The browser check says how often; nothing asserts it.
# ("they need pay" was in SIMILAR until the first browser run woke on it once.)
CLOSE = ["hey Liv, pay", "hey, need pay", "they need pay", "hey, did Niv pay", "hey NetPay", "hey, Liv paid", "hey, new pay", "hey Neil, pay"]

def room(rng, seconds):
    return rng.standard_normal(int(seconds * F.SR)) * 10 ** (-62 / 20)

def everyday(rng, audio):
    """A fixed, ordinary phone: a small room, the phone's band, pink noise 20 dB down."""
    from scipy.signal import butter, sosfilt, fftconvolve
    rt60 = 0.3
    t = np.arange(int(F.SR * rt60)) / F.SR
    h = rng.standard_normal(len(t)) * np.exp(-6.9 * t / rt60); h[0] = 4; h /= np.sqrt(np.sum(h ** 2))
    x = fftconvolve(audio, h)[: len(audio)]
    x = sosfilt(butter(2, [150, 6000], btype="band", fs=F.SR, output="sos"), x)
    voiced = np.sqrt(np.mean(x[np.abs(x) > np.abs(x).max() * 0.05] ** 2))
    x = x / (voiced + 1e-9) * 0.08
    n = F.colored_noise(rng, len(x), "pink")
    return np.clip(x + n / F.rms(n) * 0.08 / 10, -1, 1)

def write(path, x):
    sf.write(path, np.clip(x, -1, 1), F.SR, subtype="PCM_16")
    print(path, f"{len(x) / F.SR:.1f} s")

def lvl(c):
    return c / (F.rms(c) + 1e-9) * F.LEVEL

def main(clf_path, testdata, browser):
    rng = np.random.default_rng(2026)
    pos, pmeta = F.load("pos_test")
    conf, cmeta = F.load("conf_test")
    talk, _ = F.load("speech_test")
    os.makedirs(testdata, exist_ok=True); os.makedirs(browser, exist_ok=True)

    # The "Hey NivPay" clips: the plain phrase, said by different held-out voices.
    plain = [i for i, m in enumerate(pmeta) if m["text"] == "hˈeɪ nˈɪv pˈeɪ"]
    voices = {}
    for i in plain: voices.setdefault(pmeta[i]["voice"], i)
    one = pos[voices.get("bf_lily", plain[0])]
    wake = everyday(rng, np.concatenate([room(rng, 2.0), lvl(one), room(rng, 2.0)]))
    write(f"{testdata}/hey-nivpay.wav", wake)
    loop = [room(rng, 2.5)]
    for v in sorted(voices)[:4]:
        loop += [lvl(pos[voices[v]]), room(rng, 5.0)]
    write(f"{browser}/wake.wav", everyday(rng, np.concatenate(loop)))

    def similar(phrases):
        parts = [room(rng, 1.0)]
        for p in phrases:
            idx = [i for i, m in enumerate(cmeta) if m["text"] == p]
            parts += [lvl(conf[idx[rng.integers(len(idx))]]), room(rng, 0.9)]
        return everyday(rng, np.concatenate(parts))
    write(f"{testdata}/similar.wav", similar(SIMILAR[:8]))
    write(f"{browser}/similar.wav", similar(SIMILAR + SIMILAR[::-1][:8]))
    write(f"{browser}/close.wav", similar(CLOSE + CLOSE[::-1]))

    def sentences(seconds):
        parts, total = [room(rng, 0.5)], 0
        for c in (talk[i] for i in rng.permutation(len(talk))):
            parts += [lvl(c), room(rng, rng.uniform(0.2, 0.8))]
            total += len(c) / F.SR
            if total > seconds: break
        return everyday(rng, np.concatenate(parts))
    write(f"{testdata}/talk.wav", sentences(9))
    write(f"{browser}/talk.wav", sentences(100))

    # What the reference makes of hey-nivpay.wav, read back exactly as the test reads it.
    pcm = sf.read(f"{testdata}/hey-nivpay.wav", dtype="int16")[0].astype(np.float64)
    M = F.mel(pcm, F.MELW)
    E = F.embed_windows(M, os.path.join(F.MODELS, "embedding_model.onnx"))
    clf = np.load(clf_path)
    W = E[np.arange(16)[None] + np.arange(len(E) - 15)[:, None]]
    json.dump({"mel": M[:30].round(5).tolist(), "melFrames": len(M), "embeddings": E.round(5).tolist(),
               "scores": [round(float(s), 6) for s in scores(clf, W)]}, open(f"{testdata}/reference.json", "w"))
    print("reference", M.shape, E.shape)

if __name__ == "__main__":
    main(*sys.argv[1:4])
