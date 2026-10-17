"""Measures a trained classifier on the held-out voices (gen.py TEST_VOICES), never trained on.

  * wakes: each "Hey NivPay" clip in a scene (quiet, everyday, noisy); heard if a wake
    ends between 0.2 s before and 1 s after the phrase's end
  * similar words: each confusable clip in a scene; a false wake if it wakes at all
  * talk: all held-out sentences one after another as one long recording, and
    background noise, counted as false wakes per hour with the app's 2 s refractory
A wake, as in the app, is `hold` scores in a row at or above the threshold.
The scores are kept (raw.npz), so any threshold and hold can be read off them.

Usage: evaluate.py <classifier.npz> <out dir> [threshold hold]
"""
import sys, os, json, pickle, numpy as np
from collections import defaultdict
sys.path.insert(0, os.path.dirname(__file__))
import features as F

def scores(clf, W):
    x = W.reshape(len(W), -1).astype(np.float64)
    j = 0
    while f"w{j}" in clf:
        x = x @ clf[f"w{j}"].T.astype(np.float64) + clf[f"b{j}"]
        if f"w{j+1}" in clf: x = np.maximum(x, 0)
        j += 1
    return 1 / (1 + np.exp(-x[:, 0]))

def wakes_at(s, th, hold=1, refractory=25):
    """Indices where the app would wake: `hold` scores in a row at or above th, then 2 s of quiet."""
    out, quiet, run = [], 0, 0
    for i, v in enumerate(s):
        if quiet: quiet -= 1; run = 0; continue
        run = run + 1 if v >= th else 0
        if run >= hold: out.append(i); quiet = refractory; run = 0
    return out

def collect(clf, rng):
    pool = F.load("speech_test")[0] + F.load("speech2_test")[0]
    scene = F.Scene(rng, pool)
    raw = {"pos": {}, "similar": defaultdict(list)}
    pos, pmeta = F.load("pos_test")
    keep = [i for i, m in enumerate(pmeta) if "iːv" not in m["text"]]  # "Hey Neev Pay" is not a wake
    for cond in ("quiet", "everyday", "noisy"):
        clips = []
        for i in keep:
            audio, s0, s1 = scene.place(pos[i], rng.uniform(1.6, 2.4), 1.2, speech_after=False, speech_before=(cond != "quiet" and rng.random() < 0.3))
            if cond == "quiet":
                audio = audio + rng.standard_normal(len(audio)) * 1e-4
                audio = audio / (F.rms(audio) + 1e-9) * 10 ** (rng.uniform(-30, -20) / 20)
            elif cond == "everyday":
                audio = scene.mic(audio)
            else:
                bg = scene.background(len(audio))
                while bg is None: bg = scene.background(len(audio))
                audio = audio + bg / (F.rms(bg) + 1e-9) * F.rms(audio) / 10 ** (5 / 20)
                audio = np.clip(audio / (F.rms(audio) + 1e-9) * 0.05, -1, 1)
            W, ends = F.windows(audio)
            clips.append((scores(clf, W), ends, s1))
        raw["pos"][cond] = clips
        print("scored", cond, flush=True)
    conf, cmeta = F.load("conf_test")
    for c, m in zip(conf, cmeta):
        audio, _, _ = scene.place(c, rng.uniform(1.6, 2.4), 1.0, speech_after=rng.random() < 0.3)
        W, _ = F.windows(scene.mic(audio))
        raw["similar"][m["text"]].append(scores(clf, W))
    raw["similar"] = dict(raw["similar"])
    print("scored similar", flush=True)
    seg, total, talk = [], 0, []
    for c in pool:
        seg += [c / (F.rms(c) + 1e-9) * F.LEVEL, np.zeros(int(rng.uniform(0.2, 1.5) * F.SR))]
        if sum(len(x) for x in seg) > 30 * F.SR:
            a = scene.mic(np.concatenate(seg)); total += len(a)
            talk.append(scores(clf, F.windows(a)[0])); seg = []
    raw["talk"], raw["talk_hours"] = talk, total / F.SR / 3600
    noise, ntotal = [], 0
    for _ in range(80):
        n = int(rng.uniform(20, 40) * F.SR)
        b = scene.background(n)
        b = np.zeros(n) if b is None else b
        a = scene.mic(b + 1e-6 * rng.standard_normal(n), noise_only=True); ntotal += n
        noise.append(scores(clf, F.windows(a)[0]))
    raw["noise"], raw["noise_hours"] = noise, ntotal / F.SR / 3600
    print("scored talk and noise", flush=True)
    return raw

def metrics(raw, th, hold):
    out = {}
    for cond, clips in raw["pos"].items():
        heard = 0
        for s, ends, s1 in clips:
            heard += any(s1 - 0.2 * F.SR <= ends[i] <= s1 + 1.0 * F.SR for i in wakes_at(s, th, hold, refractory=0))
        out[f"heard_{cond}"] = heard / len(clips)
    per = {k: float(np.mean([len(wakes_at(s, th, hold)) > 0 for s in v])) for k, v in raw["similar"].items()}
    out["similar"] = float(np.mean([len(wakes_at(s, th, hold)) > 0 for v in raw["similar"].values() for s in v]))
    out["similar_by_phrase"] = per
    out["talk_per_hour"] = sum(len(wakes_at(s, th, hold)) for s in raw["talk"]) / raw["talk_hours"]
    out["noise_per_hour"] = sum(len(wakes_at(s, th, hold)) for s in raw["noise"]) / raw["noise_hours"]
    return out

def table(raw):
    for hold in (1, 2, 3, 4):
        for th in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
            m = metrics(raw, th, hold)
            print(f"hold {hold} th {th}: heard quiet {m['heard_quiet']:.3f} everyday {m['heard_everyday']:.3f} noisy {m['heard_noisy']:.3f} | "
                  f"similar {m['similar']:.3f} talk/h {m['talk_per_hour']:.2f} noise/h {m['noise_per_hour']:.2f}", flush=True)

if __name__ == "__main__":
    clf = np.load(sys.argv[1]); out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    rawp = os.path.join(out, "raw.pkl")
    if os.path.exists(rawp): raw = pickle.load(open(rawp, "rb"))
    else:
        raw = collect(clf, np.random.default_rng(42))
        pickle.dump(raw, open(rawp, "wb"))
    print(f"held-out: {len(raw['pos']['quiet'])} wake clips, {sum(len(v) for v in raw['similar'].values())} similar, "
          f"talk {raw['talk_hours'] * 60:.0f} min, noise {raw['noise_hours'] * 60:.0f} min")
    if len(sys.argv) > 4:
        m = metrics(raw, float(sys.argv[3]), int(sys.argv[4]))
        json.dump(m, open(os.path.join(out, "report.json"), "w"), indent=1)
        print({k: v for k, v in m.items() if k != "similar_by_phrase"})
    else:
        table(raw)
