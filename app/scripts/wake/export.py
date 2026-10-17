"""Writes the wake word model file the app reads (src/lib/wake/engine.ts parseModel).

Usage: export.py <classifier.npz> <out.bin> [threshold hold]
The classifier file holds w0,b0,w1,b1,... ([out][in] and [out]), `window`, `threshold` and `hold`;
a threshold and hold given here, chosen from evaluate.py's table, take their place.
"""
import json, struct, sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from front import load_front
WORK = os.environ.get("WAKE_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "work"))

def export(clf_path, out_path, mel_path, emb_path, threshold=None, hold=None):
    _, layers = load_front(mel_path, emb_path)
    clf = dict(np.load(clf_path))
    if threshold is not None: clf["threshold"], clf["hold"] = float(threshold), int(hold)
    tensors, order, emb = [], [], []
    def add(name, a):
        a = np.ascontiguousarray(a, dtype="<f4")
        tensors.append((name, list(a.shape), a))
    ci = 0
    for l in layers:
        if l[0] == "conv":
            add(f"conv{ci}.w", l[1]); add(f"conv{ci}.b", l[2]); emb.append({"conv": f"conv{ci}"}); ci += 1
        elif l[0] == "act":
            emb.append({"act": [float(np.float32(l[1])), float(np.float32(l[2]))]})
        else:
            emb.append({"pool": list(l[1])})
    dense = []
    i = 0
    while f"w{i}" in clf:
        add(f"dense{i}.w", clf[f"w{i}"]); add(f"dense{i}.b", clf[f"b{i}"]); dense.append(f"dense{i}"); i += 1
    header = {"version": 1, "tensors": [{"name": n, "shape": s} for n, s, _ in tensors], "embedding": emb,
              "window": int(clf["window"]), "dense": dense, "threshold": float(clf["threshold"]),
              "hold": int(clf["hold"]) if "hold" in clf else 1}
    hb = json.dumps(header, separators=(",", ":")).encode()
    with open(out_path, "wb") as f:
        f.write(b"NPWW" + struct.pack("<I", len(hb)) + hb)
        f.write(b"\0" * ((-(8 + len(hb))) % 4))
        for _, _, a in tensors: f.write(a.tobytes())
    print(out_path, os.path.getsize(out_path), "bytes")

if __name__ == "__main__":
    models = os.path.join(WORK, "models")
    export(sys.argv[1], sys.argv[2], os.path.join(models, "melspectrogram.onnx"), os.path.join(models, "embedding_model.onnx"), *sys.argv[3:5])
