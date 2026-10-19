#!/bin/sh
# Turns the frames written by record.mjs into docs/demo.mp4 (the whole show) and docs/demo.gif
# (highlights at 1.6x speed). Frame ranges for the GIF are picked from marks.json by eye.
# usage: tools/demo/encode.sh <frames-dir> [gif-select-expression]
set -e
F="${1:?frames dir}"
SEL="${2:-between(n,30,200)+between(n,619,769)+between(n,947,1247)+between(n,1365,1614)+between(n,1845,1955)+between(n,2075,2235)+between(n,2300,2410)}"
ffmpeg -loglevel error -y -framerate 20 -i "$F/%05d.jpg" \
  -c:v libx264 -pix_fmt yuv420p -crf 24 -preset slow -vf "scale=854:-2" -movflags +faststart docs/demo.mp4
ffmpeg -loglevel error -y -framerate 20 -i "$F/%05d.jpg" \
  -vf "select='$SEL',setpts=N/(32*TB),fps=8,scale=540:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  -loop 0 docs/demo.gif
