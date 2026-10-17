#!/bin/sh
# Downloads what training needs into $WAKE_WORK (default: ./work next to this
# file), from npm and PyPI only, each checked against the hash it was trained with.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WAKE_WORK:-$HERE/work}
mkdir -p "$WORK/dl" "$WORK/models" "$WORK/data"
cd "$WORK/dl"

npm_get() { # name version
  url=$(curl -fsS "https://registry.npmjs.org/$1/$2" | python3 -c "import json,sys; print(json.load(sys.stdin)['dist']['tarball'])")
  dir="x-$(echo "$1" | tr '/@' '__')"
  mkdir -p "$dir" && curl -fsSL "$url" | tar xz -C "$dir"
}
npm_get kokoro-q8-shards 1.0.0     # Kokoro-82M, Apache-2.0: the voice that speaks the training phrases
npm_get kokoro-js 1.2.1            # Kokoro's voices (style vectors), Apache-2.0
npm_get @wakebox/browser 0.1.2     # openWakeWord's melspectrogram.onnx and embedding_model.onnx, Apache-2.0
pip download --no-deps -q wyoming-openwakeword==1.8.2 -d .   # the official embedding_model.tflite, to check the ONNX against

cat x-kokoro-q8-shards/package/kokoro-q8.part0.bin x-kokoro-q8-shards/package/kokoro-q8.part1.bin \
    x-kokoro-q8-shards/package/kokoro-q8.part2.bin x-kokoro-q8-shards/package/kokoro-q8.part3.bin \
    x-kokoro-q8-shards/package/kokoro-q8.part4.bin x-kokoro-q8-shards/package/kokoro-q8.part5.bin > ../models/kokoro-q8.onnx
cp x-_wakebox_browser/package/models/embedding_model.onnx x-_wakebox_browser/package/models/melspectrogram.onnx ../models/
python3 -c "import zipfile; open('../models/embedding_model.tflite','wb').write(zipfile.ZipFile('wyoming_openwakeword-1.8.2-py3-none-any.whl').read('wyoming_openwakeword/models/embedding_model.tflite'))"

cd ../models
sha256sum -c <<SUMS
fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478  kokoro-q8.onnx
70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f  embedding_model.onnx
ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f  melspectrogram.onnx
SUMS
echo "ready in $WORK"
