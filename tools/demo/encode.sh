#!/bin/sh
# Turns the frames written by record.mjs into docs/demo.mp4 (the whole show) and docs/demo.gif
# (highlights at 1.6x speed). Frame ranges for the GIF are picked from marks.json by eye.
# usage: tools/demo/encode.sh <frames-dir> [gif-select-expression]
set -e
F="${1:?frames dir}"
SEL="${2:-between(n,30,200)+between(n,615,765)+between(n,900,1200)+between(n,1300,1550)+between(n,1735,1845)+between(n,1967,2127)+between(n,2192,2302)}"
ffmpeg -loglevel error -y -framerate 20 -i "$F/%05d.jpg" \
  -c:v libx264 -pix_fmt yuv420p -crf 24 -preset slow -vf "scale=854:-2" -movflags +faststart docs/demo.mp4
ffmpeg -loglevel error -y -framerate 20 -i "$F/%05d.jpg" \
  -vf "select='$SEL',setpts=N/(32*TB),fps=8,scale=540:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  -loop 0 docs/demo.gif
