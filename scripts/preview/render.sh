#!/bin/sh
# POSIX sh (Linux, macOS; on Windows use Git Bash or WSL). Author-only tool: nothing in CI or in the mod needs it.
# Renders preview.svg to ../../preview.png (1100x705).
# Needs an SVG rasteriser: rsvg-convert (librsvg), or Inkscape, or ImageMagick.
# Fonts: the SVG asks for Geist, then common system sans fonts; install any one of them.
# preview.png is an ILLUSTRATION with invented data. Before publishing, replace it with a real
# screenshot of the dialog taken on sample data (see .github/PUBLISH-CHECKLIST.md).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
src="$here/preview.svg"
out="$here/../../preview.png"
if command -v rsvg-convert >/dev/null 2>&1; then
  rsvg-convert -w 1100 -h 705 "$src" -o "$out"
elif command -v inkscape >/dev/null 2>&1; then
  inkscape "$src" --export-type=png --export-filename="$out" -w 1100 -h 705
elif command -v magick >/dev/null 2>&1; then
  magick -background none -density 96 "$src" -resize 1100x705! "$out"
else
  echo "render.sh: install rsvg-convert, inkscape or imagemagick" >&2
  exit 1
fi
echo "wrote preview.png"
