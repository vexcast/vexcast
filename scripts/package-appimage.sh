#!/usr/bin/env bash
# Make the AppImage from `tauri build --bundles appimage` self-contained: add the OBS Studio
# build installed on the build machine (official PPA) — the graphics module, plugins (with the
# browser source) and data — plus the libraries they need. libobs itself is already inside,
# because the app links it.
#
#   scripts/package-appimage.sh <tauri .AppImage> <output .AppImage>
#
# Inside the AppImage the engine only loads this OBS (crates/vexcast-core/src/obs/runtime.rs),
# so a different OBS version installed on the user's system doesn't interfere.
set -euo pipefail
src=$(realpath "$1")
out=$(realpath -m "$2")
multi=$(gcc -dumpmachine 2>/dev/null || echo x86_64-linux-gnu)
lib=/usr/lib/$multi
[ -d "$lib/obs-plugins" ] || { echo "OBS Studio is not installed in $lib (add ppa:obsproject/obs-studio)"; exit 1; }

tools=${XDG_CACHE_HOME:-$HOME/.cache}/vexcast-appimage
mkdir -p "$tools"
[ -x "$tools/appimagetool" ] || { curl -fsSL -o "$tools/appimagetool" https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage; chmod +x "$tools/appimagetool"; }
[ -s "$tools/excludelist" ] || curl -fsSL -o "$tools/excludelist" https://raw.githubusercontent.com/AppImageCommunity/pkg2appimage/master/excludelist
export APPIMAGE_EXTRACT_AND_RUN=1

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
(cd "$work" && "$src" --appimage-extract >/dev/null)
app=$work/squashfs-root
[ -d "$app/usr/lib" ] || { echo "Unexpected AppImage layout"; exit 1; }

# The OBS frontend's own plugins need its Qt UI; they stay out.
skip='^(frontend-tools|obs-websocket|decklink-captions|decklink-output-ui|aja-output-ui)'
mkdir -p "$app/usr/lib/obs-plugins" "$app/usr/share/obs/obs-plugins"
cp -a "$lib"/libobs-opengl.so* "$app/usr/lib/"
for f in "$lib"/obs-plugins/*; do
  n=$(basename "$f"); [[ $n =~ $skip ]] && continue
  cp -a "$f" "$app/usr/lib/obs-plugins/"
done
cp -a /usr/share/obs/libobs "$app/usr/share/obs/"
for d in /usr/share/obs/obs-plugins/*; do
  n=$(basename "$d"); [[ $n =~ $skip ]] && continue
  cp -a "$d" "$app/usr/share/obs/obs-plugins/"
done

# Libraries the plugins need that aren't inside yet (minus the ones every system has: glibc,
# GL, X11… — the AppImage exclude list).
excluded=$(sed 's/#.*//; s/[[:space:]]//g; /^$/d' "$tools/excludelist")
is_excluded() { grep -qxF "$1" <<<"$excluded"; }
have() { [ -e "$app/usr/lib/$1" ] || [ -e "$app/usr/lib/obs-plugins/$1" ]; }
added=0
while IFS= read -r elf; do
  while read -r dep; do
    name=$(basename "$dep")
    have "$name" && continue
    is_excluded "$name" && continue
    cp -L "$dep" "$app/usr/lib/$name"
    patchelf --set-rpath '$ORIGIN' "$app/usr/lib/$name" 2>/dev/null || true
    added=$((added + 1))
  done < <(ldd "$elf" 2>/dev/null | awk '/=> \// { print $3 }')
done < <(find "$app/usr/lib/obs-plugins" "$app/usr/lib" -maxdepth 1 -type f \( -name '*.so*' -o -perm -u+x \) -exec sh -c 'file -b "$1" | grep -q "^ELF"' _ {} \; -print)
echo "Added $added libraries"

# Plugins find their libraries next to them (libcef.so) and in usr/lib.
for f in "$app"/usr/lib/obs-plugins/*.so "$app"/usr/lib/obs-plugins/obs-browser-page; do
  [ -f "$f" ] && patchelf --set-rpath '$ORIGIN:$ORIGIN/..' "$f" 2>/dev/null || true
done
for f in "$app"/usr/lib/libobs-opengl.so*; do
  [ -f "$f" ] && [ ! -L "$f" ] && patchelf --set-rpath '$ORIGIN' "$f" || true
done

rm -f "$out"
ARCH=x86_64 "$tools/appimagetool" --no-appstream "$app" "$out"
echo "AppImage ready: $out ($(du -h "$out" | cut -f1))"
