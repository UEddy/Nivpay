"""Synthesises the clips for training and testing "Hey NivPay". Usage: gen.py <job> <worker> <nworkers>"""
import sys, json, random, numpy as np, os
sys.path.insert(0, os.path.dirname(__file__))
import tts
WORK = os.environ.get("WAKE_WORK", os.path.join(os.path.dirname(os.path.abspath(__file__)), "work"))

TEST_VOICES = ["af_nova", "af_river", "am_onyx", "am_puck", "bf_lily", "bm_lewis", "hm_psi", "if_sara"]
EN = [v for v in tts.VOICES if v[:2] in ("af", "am", "bf", "bm") and v not in TEST_VOICES]
ACCENT = [v for v in tts.VOICES if v[:2] in ("ef", "em", "ff", "hf", "hm", "if", "im", "pf", "pm") and v not in TEST_VOICES]
FAR = [v for v in tts.VOICES if v[0] in "jz"]

def train_voice(rng):
    r = rng.random()
    if r < 0.45: names = [rng.choice(EN)]
    elif r < 0.6: names = [rng.choice(ACCENT)]
    elif r < 0.63: names = [rng.choice(FAR)]
    else: names = list(rng.choice(EN + ACCENT, size=rng.integers(2, 4), replace=False))
    w = rng.dirichlet(np.ones(len(names)))
    style = sum(wi * tts.VOICES[n] for wi, n in zip(w, names))
    return "+".join(names), style

def test_voice(rng):
    n = rng.choice(TEST_VOICES)
    return n, tts.VOICES[n]

TARGET = [("hˈeɪ nˈɪv pˈeɪ", 30), ("hˈeɪ nˈɪvpeɪ", 10), ("hˈeɪ, nˈɪv pˈeɪ", 10), ("hˈeɪ nˈɪv pˈeɪ.", 8), ("hˈeɪ nˈɪv pˈeɪ!", 6),
          ("hˈeɪ nˈɪv pˈeɪ?", 4), ("heɪ nˈɪv pˈeɪ", 8), ("hˈeɪ nˈɪvpˌeɪ", 8), ("ˈeɪ nˈɪv pˈeɪ", 4), ("hˈeɪ nˈiːv pˈeɪ", 6),
          ("hˈeɪ... nˈɪv pˈeɪ", 3), ("hˈeɪ nˈɪv pˈeɪ,", 3)]

CONFUSABLE = """hey Venmo|hey PayPal|hey Siri|hey Google|OK Google|Alexa|hey Alexa|hey Nick|hey Nick, pay|hey, Nick paid|hey Liv|hey Liv, pay
hey Kev, pay|hey Steve, pay|hey Neve|hey Neve, pay|hey, new pay|hey nifty|hey Nippy|hey Nicky|navy pay|hey Nate, pay|hey Ned, pay
hey Neil, pay|hey Nev|hey Niv|hey Nikki, pay|hey Siv, pay|hey BitPay|hey Zelle|hey Cash App|hey nephew|hey Neville|hey Nigel|hey Nina
hey Kim, pay|hey Ivy|Nivea|hey Nivea|hey Liv, play|eBay|hey eBay|hey, Steve pays|they give pay|they'll pay|hey, if I pay|hey, did you pay
hey, Niv's place|heavy pay|hey, give pay|hey, nice play|any day|hey there|hey you|hey, pay me|hey Mitch, pay|hey Vinnie, pay
NivPay|open NivPay|I use NivPay|send it on NivPay|did you get my NivPay|pay me on NivPay|my NivPay account|hey, it's on NivPay
hey, live pay|hey, need pay|hey, Liv paid|hey Tim, pay|hey Ken, pay|hey Jen, pay|hey, Bev, pay|hey, Gibb, pay|hey Riv, pay
hey, give way|hey, it's payday|happy payday|hey, Mick, pay|hey, Rick, pay|hey, Viv, pay|hey Viv|hey Niv, hey|hey Neve, hey
hey, Nevada|hey, never pay|hey, Nick's play|hey nip, hey|hey Kip, pay|hey, did Niv pay|hey, Nick, play|hey bae|hey hey|okay pay""".replace("\n", "|").split("|")
CONFUSABLE_TEST_ONLY = ["hey Liv, pay me", "hey Nick, pay up", "hey Kev, play", "hey, Ziv, pay", "hey, Dev, pay", "hey Nev, pay",
                        "hey NetPay", "hey, Niv, wait", "hey, Lynn, pay", "hey, Steph, pay", "hey Pip, pay", "they need pay"]

NAMES = ["Sam", "Ana", "Mia", "Leo", "Kofi", "Priya", "Tom", "Grace", "Luis", "Amara", "Ben", "Chen", "Fatima", "Joe", "Nick", "Liv", "Kevin", "Nina"]
POTS = ["rent", "holiday", "groceries", "birthday", "trip", "dinner", "bills", "gift"]
NUMS = ["five", "ten", "twenty", "thirty five", "fifty", "a hundred", "twelve fifty", "eighty", "two hundred", "forty"]
CHAT = ["hey, how are you doing", "hey there, long time no see", "hey, can you pass me the salt", "hey, did you pay the rent yet",
        "hey, are we still on for dinner", "hey, give me a minute", "hey, nice to meet you", "hey, I sent you the money",
        "pay me back when you can", "I'll pay you tomorrow", "did you get paid this week", "never mind, I'll do it", "hey, what's up",
        "hey, whatever you think is fine", "I need to pay the electricity bill", "can you split the bill with me", "okay, let's go",
        "hey, where did you put the keys", "send me the link please", "hey, I'm almost there", "heavy rain again today",
        "the new payment app is pretty good", "pay day is on Friday", "hey, happy birthday", "hey, are you listening"]

def conversational(rng):
    k = rng.integers(0, 5)
    n, p, x = rng.choice(NAMES), rng.choice(POTS), rng.choice(NUMS)
    if k == 0: return f"send {x} dollars to {n}"
    if k == 1: return f"put {x} in the {p} pot"
    if k == 2: return f"pay {n} {x}"
    if k == 3: return f"hey {n}, " + rng.choice(CHAT).replace("hey, ", "").replace("hey ", "")
    return rng.choice(CHAT)

def run(job, worker, nworkers):
    import zlib; rng = np.random.default_rng(zlib.crc32(job.encode()) * 100 + worker)
    sents = json.load(open(os.path.join(os.path.dirname(__file__), "sentences.json")))
    clips, meta = [], []
    test = job.endswith("_test")
    pick = test_voice if test else train_voice
    if job.startswith("pos"):
        n = {"pos_train": 4200, "pos_test": 600}[job]
        ph, wt = zip(*TARGET); wt = np.array(wt, float) / sum(wt)
        items = [("ph", ph[rng.choice(len(ph), p=wt)]) for _ in range(n)]
    elif job.startswith("conf"):
        phrases = CONFUSABLE + (CONFUSABLE_TEST_ONLY if test else [])
        reps = 8 if test else 40
        items = [("txt", p) for p in phrases for _ in range(reps)]
    elif job.startswith("speech"):
        n = {"speech_train": 2400, "speech2_train": 2400, "speech_test": 600, "speech2_test": 1200}[job]
        split = int(len(sents) * 0.85)
        pool = sents[split:] if test else sents[:split]
        items = [("txt", pool[i % len(pool)] if rng.random() < 0.65 else conversational(rng)) for i in rng.permutation(n * 2)[:n]]
    items = items[worker::nworkers]
    for kind, val in items:
        vname, style = pick(rng)
        speed = float(rng.uniform(0.8, 1.25))
        lang = "en-gb" if vname[:1] == "b" and rng.random() < 0.8 else "en-us"
        phon = val if kind == "ph" else tts.phonemize(val, lang)
        a = tts.say(phon, style, speed)
        if len(a) < 1600: continue
        clips.append(a.astype(np.float16)); meta.append({"text": val, "voice": vname, "speed": speed})
    os.makedirs(os.path.join(WORK, "data"), exist_ok=True)
    np.savez(os.path.join(WORK, "data", f"{job}_{worker}.npz"), audio=np.array(clips, dtype=object), meta=json.dumps(meta))
    print(job, worker, len(clips))

if __name__ == "__main__":
    run(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
