#!/bin/zsh
# Builds "build/Exploding Nerds - Mac.zip" (the app, universal, ad hoc signed) with just the Xcode Command Line Tools.
set -euo pipefail
cd "${0:A:h}"

OUT="$PWD/build/Exploding Nerds - Mac.zip"
WORK=$(mktemp -d)
APP="$WORK/Exploding Nerds.app"
mkdir -p "${OUT:h}" "$APP/Contents/MacOS" "$APP/Contents/Resources" "$WORK/AppIcon.iconset"

# Universal binary: Apple Silicon and Intel.
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos14" -o "$WORK/ExplodingNerds-$arch" mac/*.swift
done
lipo -create -output "$APP/Contents/MacOS/ExplodingNerds" "$WORK/ExplodingNerds-arm64" "$WORK/ExplodingNerds-x86_64"

cp -R game "$APP/Contents/Resources/"

# App icon: the Exploding Nerd card padded to a square.
sips -s format png --padToHeightWidth 840 840 game/cards/c01.webp --out "$WORK/icon.png" >/dev/null
for size in 16 32 128 256 512; do
  sips -z $size $size "$WORK/icon.png" --out "$WORK/AppIcon.iconset/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$WORK/icon.png" --out "$WORK/AppIcon.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$WORK/AppIcon.iconset" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Exploding Nerds</string>
  <key>CFBundleDisplayName</key><string>Exploding Nerds</string>
  <key>CFBundleIdentifier</key><string>com.dualboot.explodingnerds</string>
  <key>CFBundleExecutable</key><string>ExplodingNerds</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.card-games</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSLocalNetworkUsageDescription</key><string>Exploding Nerds uses the local network to host and join games.</string>
  <key>NSBonjourServices</key><array><string>_explodingnerds._tcp</string></array>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
EOF

codesign --force --sign - "$APP"
rm -f "$OUT"
ditto -c -k --keepParent "$APP" "$OUT"
rm -rf "$WORK"
echo "Built $OUT"
