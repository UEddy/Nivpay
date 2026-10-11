#!/usr/bin/env bash
# Contact sheets of the changing frames of one clip, each stamped with its
# time in seconds, into footage/_frames/sheets/. Review aid only; local.
set -euo pipefail
F="$LOCALAPPDATA/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin"
c="$1"
cd "$(dirname "$0")/../footage/_frames"
mkdir -p sheets; cp -n /c/Windows/Fonts/arial.ttf font.ttf
rm -f sheets/${c}_*.jpg
"$F/ffmpeg.exe" -v error -y -framerate 2 -i "$c/f%05d.jpg" \
  -vf "mpdecimate=hi=64*150:lo=64*60:frac=0.1,drawtext=fontfile=font.ttf:text='%{pts\:flt\:1}':x=8:y=h-90:fontsize=64:fontcolor=yellow:box=1:boxcolor=black@0.8,scale=270:-2,tile=8x2:padding=4" \
  -fps_mode passthrough -q:v 3 "sheets/${c}_%03d.jpg"
ls sheets/${c}_*.jpg | wc -l
