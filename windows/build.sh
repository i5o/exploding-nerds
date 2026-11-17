#!/bin/zsh
# Builds "build/Exploding Nerds - Windows.zip" on this Mac. Inside: "Exploding Nerds" for regular (Intel/AMD) PCs and
# "Exploding Nerds (ARM)" for Windows on ARM (Snapdragon laptops, a Windows VM on an Apple Silicon Mac).
# Each is Electron's own Windows build with this app in resources/app, so nothing here needs Windows or Wine.
set -euo pipefail
cd "${0:A:h}"

OUT="${PWD:h}/build/Exploding Nerds - Windows.zip"
WORK=$(mktemp -d)
APPDIR="$WORK/app"
ICONS="$WORK/icons"
mkdir -p "${OUT:h}" "$APPDIR" "$ICONS" "$WORK/zip"
[[ -d node_modules ]] || npm install --no-audit --no-fund

# The app itself, the same for both CPUs: shell, game, window icon, and the one runtime dependency (plain JS).
cp package.json main.js preload.js "$APPDIR/"
cp -R ../game "$APPDIR/"
sips -s format png --padToHeightWidth 840 840 ../game/cards/c01.webp --out "$APPDIR/icon.png" >/dev/null
sips -z 256 256 "$APPDIR/icon.png" >/dev/null
(cd "$APPDIR" && npm install --omit=dev --no-audit --no-fund --no-package-lock --loglevel=error && rm -rf node_modules/.bin)
# The same picture as the .exe's own icon (Explorer, shortcuts), in the sizes Windows picks from.
for s in 16 32 48 256; do sips -z $s $s "$APPDIR/icon.png" --out "$ICONS/$s.png" >/dev/null; done

for ARCH NAME in x64 "Exploding Nerds" arm64 "Exploding Nerds (ARM)"; do
  APP="$WORK/zip/$NAME"
  # Electron for Windows, fetched by Electron's own downloader and checked against the checksums in its npm package.
  ZIP=$(node -e "
    const { downloadArtifact } = require('@electron/get');
    downloadArtifact({ version: require('electron/package.json').version, platform: 'win32', arch: process.argv[1],
      artifactName: 'electron', checksums: require('electron/checksums.json') }).then(console.log);" $ARCH)
  mkdir -p "$APP"
  unzip -q "$ZIP" -d "$APP"
  mv "$APP/electron.exe" "$APP/Exploding Nerds.exe"
  rm "$APP/resources/default_app.asar"
  cp -R "$APPDIR" "$APP/resources/app"
  # Make the exe ours: icon (Explorer, taskbar) and name (Task Manager, file properties) instead of Electron's.
  # Electron's Windows exe is unsigned, so no signature breaks.
  node --input-type=module -e "
    import fs from 'fs';
    import { NtExecutable, NtExecutableResource, Data, Resource } from 'resedit';
    const [exePath, dir] = process.argv.slice(1);
    const exe = NtExecutable.from(fs.readFileSync(exePath));
    const res = NtExecutableResource.from(exe);
    const group = res.entries.find(e => e.type === 14); // RT_GROUP_ICON: the app icon
    const icons = [16, 32, 48, 256].map(s => Data.RawIconItem.from(fs.readFileSync(dir + '/' + s + '.png'), s, s, 32));
    Resource.IconGroupEntry.replaceIconsForResource(res.entries, group.id, group.lang, icons);
    const [info] = Resource.VersionInfo.fromEntries(res.entries);
    for (const l of info.getAllLanguagesForStringValues()) {
      info.setStringValues(l, { FileDescription: 'Exploding Nerds', ProductName: 'Exploding Nerds',
        InternalName: 'Exploding Nerds', OriginalFilename: 'Exploding Nerds.exe' });
      for (const k of ['CompanyName', 'LegalCopyright']) info.removeStringValue(l, k); // GitHub's, from Electron
    }
    info.outputToResourceEntries(res.entries);
    res.outputResource(exe);
    fs.writeFileSync(exePath, Buffer.from(exe.generate()));" "$APP/Exploding Nerds.exe" "$ICONS"
done
rm -f "$OUT"
(cd "$WORK/zip" && zip -qrX "$OUT" "Exploding Nerds" "Exploding Nerds (ARM)")
rm -rf "$WORK"
echo "Built $OUT"
