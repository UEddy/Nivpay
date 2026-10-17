import numpy as np, onnxruntime as rt, os, glob
from scipy.signal import resample_poly
from kokoro_onnx.tokenizer import Tokenizer
from kokoro_onnx.config import DEFAULT_VOCAB
WORK = os.environ.get("WAKE_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "work"))

VOICE_DIR = os.path.join(WORK, "dl", "x-kokoro-js", "package", "voices")
VOICES = {os.path.basename(p)[:-4]: np.fromfile(p, np.float32).reshape(510, 256) for p in sorted(glob.glob(VOICE_DIR + "/*.bin"))}
_tok = None
def tok():
    global _tok
    if _tok is None: _tok = Tokenizer()
    return _tok

_sess = None
def sess(threads=1):
    global _sess
    if _sess is None:
        so = rt.SessionOptions(); so.intra_op_num_threads = threads; so.inter_op_num_threads = 1
        _sess = rt.InferenceSession(os.path.join(WORK, "models", "kokoro-q8.onnx"), so)
    return _sess

def phonemize(text, lang="en-us"):
    return tok().phonemize(text, lang)

def say(phonemes, style, speed=1.0):
    """style: (510,256) voice table. Returns 16 kHz float audio in [-1,1], silence trimmed."""
    ids = [DEFAULT_VOCAB[p] for p in phonemes if p in DEFAULT_VOCAB][:500]
    s = style[len(ids)][None].astype(np.float32)
    wav = sess().run(None, {"input_ids": np.array([[0, *ids, 0]], np.int64), "style": s, "speed": np.array([speed], np.float32)})[0][0]
    wav = resample_poly(wav, 2, 3)
    return trim(wav)

def trim(wav, thresh_db=-40):
    if len(wav) == 0: return wav
    fr = 160
    n = len(wav) // fr
    e = np.sqrt((wav[: n * fr].reshape(n, fr) ** 2).mean(1) + 1e-12)
    ref = e.max()
    on = np.nonzero(e > ref * 10 ** (thresh_db / 20))[0]
    if len(on) == 0: return wav[:0]
    return wav[max(0, on[0] * fr - 320): min(len(wav), (on[-1] + 1) * fr + 320)]
