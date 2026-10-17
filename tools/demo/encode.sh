#!/bin/sh
# Turns the frames written by record.mjs into docs/demo.gif and docs/demo.mp4.
# usage: tools/demo/encode.sh <frames-dir>
set -e
F="${1:?frames dir}"
ffmpeg -loglevel error -y -framerate 20 -start_number 18 -i "$F/%05d.jpg" \
  -vf "fps=12,scale=576:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 docs/demo.gif
ffmpeg -loglevel error -y -framerate 20 -start_number 18 -i "$F/%05d.jpg" \
  -c:v libx264 -pix_fmt yuv420p -crf 23 -vf "scale=960:-2" -movflags +faststart docs/demo.mp4
