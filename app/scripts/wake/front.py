"""Numpy reference of the wake word front end: the same maths as app/src/lib/wake/engine.ts, checked against it in engine.test.ts."""
import os, numpy as np, onnx
from onnx import numpy_helper, helper
WORK = os.environ.get("WAKE_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "work"))

HOP = 160; NFFT = 512; WIN = 400
_n = np.arange(WIN)
WINDOW = np.zeros(NFFT, np.float64)
WINDOW[56:56 + WIN] = 0.5 - 0.5 * np.cos(2 * np.pi * _n / WIN)

def load_front(path_mel, path_emb):
    m = onnx.load(path_mel)
    melW = {t.name: numpy_helper.to_array(t) for t in m.graph.initializer}['1.melW'].astype(np.float32)
    e = onnx.load(path_emb)
    I = {t.name: numpy_helper.to_array(t) for t in e.graph.initializer}
    layers = []
    for n in e.graph.node:
        at = {a.name: helper.get_attribute_value(a) for a in n.attribute}
        if n.op_type == "Conv":
            w = I[n.input[1]].astype(np.float32)
            b = I[n.input[2]].astype(np.float32) if len(n.input) > 2 else np.zeros(w.shape[0], np.float32)
            layers.append(("conv", w, b))
        elif n.op_type == "LeakyRelu":
            layers.append(("act", at["alpha"], float(I["const_fold_opt__287"].ravel()[0])))
        elif n.op_type == "MaxPool":
            layers.append(("pool", tuple(at["kernel_shape"])))
    return melW, layers

def mel(audio, melW):
    """audio: float array in int16 units. Returns (frames, 32) already mapped with x/10+2."""
    audio = np.asarray(audio, np.float64)
    nfr = 1 + (len(audio) - NFFT) // HOP
    if nfr <= 0: return np.zeros((0, 32), np.float32)
    idx = np.arange(NFFT)[None, :] + HOP * np.arange(nfr)[:, None]
    spec = np.fft.rfft(audio[idx] * WINDOW, axis=1)
    p = (spec.real ** 2 + spec.imag ** 2) @ melW.astype(np.float64)
    db = 10 * np.log10(np.maximum(p, 1e-10))
    return (db / 10 + 2).astype(np.float32)

def embed_full(melseq, layers):
    """Fully convolutional over time: one 96-vector per 8 mel frames, the first for frames 0..75."""
    x = melseq[None].astype(np.float32)  # (C=1, T, F)
    for l in layers:
        if l[0] == "conv":
            w, b = l[1], l[2]
            co, ci, kt, kf = w.shape
            C, T, F = x.shape
            if kf == 3:
                x = np.pad(x, ((0, 0), (0, 0), (1, 1)))
            To = T - kt + 1
            out = np.zeros((co, To, F), np.float32) + b[:, None, None]
            for dt in range(kt):
                for df in range(kf):
                    out += np.einsum("oc,ctf->otf", w[:, :, dt, df], x[:, dt:dt + To, df:df + F])
            x = out
        elif l[0] == "act":
            x = np.maximum(np.where(x > 0, x, x * l[1]), l[2]).astype(np.float32)
        else:
            pt, pf = l[1]
            C, T, F = x.shape
            x = x[:, :T // pt * pt, :F // pf * pf].reshape(C, T // pt, pt, F // pf, pf).max(axis=(2, 4))
    return x[:, :, 0].T  # (n, 96)

_EMB = {}
def embed_windows(melseq, path=None):
    import onnxruntime as rt
    path = path or os.path.join(WORK, "models", "embedding_model.onnx")
    if path not in _EMB:
        so = rt.SessionOptions(); so.intra_op_num_threads = 2
        _EMB[path] = rt.InferenceSession(path, so)
    n = (len(melseq) - 76) // 8 + 1
    if n <= 0: return np.zeros((0, 96), np.float32)
    idx = np.arange(76)[None] + 8 * np.arange(n)[:, None]
    win = melseq[idx][..., None].astype(np.float32)
    out = [_EMB[path].run(None, {"input_1": win[i:i + 512]})[0] for i in range(0, n, 512)]
    return np.concatenate(out).reshape(n, 96)
