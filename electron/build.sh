#!/bin/zsh
# Builds "build/Exploding Nerds - Windows.zip" and "build/Exploding Nerds - Linux.tar.gz" on this Mac. Each holds
# "Exploding Nerds" for regular (Intel/AMD) PCs and "Exploding Nerds (ARM)" for ARM ones (Snapdragon laptops,
# a VM on an Apple Silicon Mac). Each is Electron's own build with this app in resources/app, so nothing here needs
# Windows, Linux or Wine.
set -euo pipefail
cd "${0:A:h}"

WIN="${PWD:h}/build/Exploding Nerds - Windows.zip"
LINUX="${PWD:h}/build/Exploding Nerds - Linux.tar.gz"
WORK=$(mktemp -d)
APPDIR="$WORK/app"
ICONS="$WORK/icons"
mkdir -p "${WIN:h}" "$APPDIR" "$ICONS"
[[ -d node_modules ]] || npm install --no-audit --no-fund

# The app itself, the same for every build: shell, game, window icon, and the one runtime dependency (plain JS).
cp package.json main.js preload.js "$APPDIR/"
cp -R ../game "$APPDIR/"
# Window title: "Exploding Nerds (<short commit>)". Electron's window follows the page title.
COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo dev)
sed -i '' "s|<title>Exploding Nerds</title>|<title>Exploding Nerds ($COMMIT)</title>|" "$APPDIR/game/index.html"
sips -s format png --padToHeightWidth 840 840 ../game/cards/c01.webp --out "$APPDIR/icon.png" >/dev/null
sips -z 256 256 "$APPDIR/icon.png" >/dev/null
(cd "$APPDIR" && npm install --omit=dev --no-audit --no-fund --no-package-lock --loglevel=error && rm -rf node_modules/.bin)
# The same picture as the .exe's own icon (Explorer, shortcuts), in the sizes Windows picks from.
for s in 16 32 48 256; do sips -z $s $s "$APPDIR/icon.png" --out "$ICONS/$s.png" >/dev/null; done

for OS ARCH NAME in win32 x64 "Exploding Nerds" win32 arm64 "Exploding Nerds (ARM)" \
                    linux x64 "Exploding Nerds" linux arm64 "Exploding Nerds (ARM)"; do
  APP="$WORK/$OS/$NAME"
  # Electron, fetched by Electron's own downloader and checked against the checksums in its npm package.
  ZIP=$(node -e "
    const { downloadArtifact } = require('@electron/get');
    downloadArtifact({ version: require('electron/package.json').version, platform: process.argv[1], arch: process.argv[2],
      artifactName: 'electron', checksums: require('electron/checksums.json') }).then(console.log);" $OS $ARCH)
  mkdir -p "$APP"
  unzip -q "$ZIP" -d "$APP"
  rm "$APP/resources/default_app.asar"
  cp -R "$APPDIR" "$APP/resources/app"
  if [[ $OS == linux ]]; then mv "$APP/electron" "$APP/exploding-nerds"; continue; fi
  mv "$APP/electron.exe" "$APP/Exploding Nerds.exe"
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
rm -f "$WIN" "$LINUX"
(cd "$WORK/win32" && zip -qrX "$WIN" *)
# COPYFILE_DISABLE and --no-xattrs keep macOS metadata (._ files, xattr headers) out of the tarball.
(cd "$WORK/linux" && COPYFILE_DISABLE=1 tar --no-xattrs -czf "$LINUX" *)
rm -rf "$WORK"
echo "Built $WIN and $LINUX"
