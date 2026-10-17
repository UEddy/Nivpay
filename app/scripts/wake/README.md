# "Hey NivPay": training and checking the wake word

How `app/public/wake/hey-nivpay-v1.bin` was made, and how to make it again.
Nothing here runs in the app or its build; the app reads only that file
(`app/src/lib/wake/engine.ts`). See the README section "Hey NivPay".

The classifier is trained only on speech made for it: Kokoro-82M (Apache-2.0)
says "Hey NivPay", phrases that sound like it, and ordinary sentences, in many
voices. openWakeWord's ready made wake words and its training sets are not
used: their licences are non-commercial. 8 of Kokoro's voices are kept apart
(`gen.py` `TEST_VOICES`) and used only to measure.

```sh
pip install -r requirements.txt          # Python 3.13
./fetch.sh                               # npm and PyPI only, hash checked, into ./work (or $WAKE_WORK)
S=$PWD; cd work                          # everything below runs in the work directory

# 1. Speech (about 2 h on 4 cores): each worker runs its jobs one after another.
for w in 0 1 2 3; do (for j in pos_test conf_test pos_train conf_train speech_test speech_train speech2_test; do python $S/gen.py $j $w 4; done) & done; wait
for w in 0 1 2; do python $S/gen.py speech2_train $w 3 & done; wait

# 2. Classifier windows: each clip in a scene. The output's name seeds the scene, so keep these names.
for i in 1 2 3; do python $S/features.py pos_train pos 1 work_g_pos$i.npz & done; wait
python $S/features.py conf_train conf 2 work_f_conf.npz
python $S/features.py speech_train speech 1 work_f_speech.npz
for i in 0 1 2; do SHARD=$i/3 python $S/features.py speech2_train speech 1 work_f_speech2_$i.npz & done; wait
python $S/features.py 1500_train noise 1 work_f_noise.npz

# 3. Train, measure on the held-out voices, pick a threshold and hold from the table, write the app's file.
python $S/train.py models/clf3b.npz work_g_pos1.npz work_g_pos2.npz work_g_pos3.npz work_f_conf.npz \
  work_f_speech.npz work_f_speech2_0.npz work_f_speech2_1.npz work_f_speech2_2.npz work_f_noise.npz
python $S/evaluate.py models/clf3b.npz eval            # the table: threshold × hold
python $S/evaluate.py models/clf3b.npz eval 0.6 3      # the one shipped, as report.json
python $S/export.py models/clf3b.npz $S/../../public/wake/hey-nivpay-v1.bin 0.6 3

# 4. The recordings the tests use, from held-out voices.
python $S/make_audio.py models/clf3b.npz $S/../../src/lib/wake/testdata browser
```

Training runs on several threads, so a new run lands close to, not exactly
on, the same weights. Given the same `clf3b.npz`, steps 3 (from `evaluate.py`)
and 4 give the same bytes.

| File | What it does |
| --- | --- |
| `fetch.sh` | Kokoro's weights and voices, openWakeWord's `melspectrogram.onnx` and `embedding_model.onnx`, and the official `embedding_model.tflite` to check them against |
| `tts.py` | Kokoro through ONNX Runtime, phonemes from espeak-ng, 24 kHz to 16 kHz |
| `gen.py` | the clips: "Hey NivPay" said a dozen ways, 105 phrases like it, sentences; 8 voices kept for testing only |
| `front.py` | the front end in numpy: the same maths as `engine.ts` |
| `features.py` | scenes (speech before and after, rooms, phone bands, levels, noise 3 to 30 dB down) and labelled windows of 16 embeddings |
| `train.py` | the classifier, 1536 → 128 → 64 → 1, in numpy: dropout, noise on the inputs, weight decay, hard negatives |
| `evaluate.py` | wakes heard (quiet, everyday, noisy), similar phrases, talk and noise per hour, at any threshold and hold |
| `export.py` | the app's file: the embedding's layers, the classifier, the threshold and hold |
| `make_audio.py` | the recordings and reference numbers `engine.test.ts` and `browser-check.mjs` use |
| `browser-check.mjs` | the built app in Chromium on localhost, with the recordings as its microphone |
| `sentences.json` | the sentences spoken: docstrings from Python's standard library and this repository's documentation |

## What was tried

Measured on the held-out voices, everyday rooms:

| Model | What changed | Heard | False wakes in talk | Similar phrases |
| --- | --- | --- | --- | --- |
| 1 | first try, 14 epochs | 96% | 6.5 to 14 an hour | 5 to 10% |
| 2 | dropout, input noise, weight decay, 8 epochs; "Hey Neev Pay" no longer a wake (too close to "hey, need pay") | 93% at hold 3 | 2.2 an hour | 4% |
| 3a | a wake counted up to 0.45 s after the phrase, not 0.3 s, so high scores come in runs | 92% at hold 3 | 1.1 an hour | 3.6% |
| 3b, shipped | 2,400 more sentences in mixed voices | 91% at hold 3, threshold 0.6 | 1.1 an hour, none in noise | 3.3% |

Most of model 1's false wakes were a single high score on a sentence nothing
like "Hey NivPay"; asking for 3 in a row (240 ms) removed nearly all of them.
Averaging models 2, 3a and 3b did no better than 3b alone.
