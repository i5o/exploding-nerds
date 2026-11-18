# Exploding Nerds

Dualboot Partners' card game (Software factory edition) as a desktop app for Mac, Windows and Linux. Play against bots
or with friends on the same network, up to 6 players, in English or Spanish.

https://github.com/user-attachments/assets/c9023639-ad1a-415b-83a7-c8511abf488e

## Download

Play in the browser at https://i5o.github.io/exploding-nerds/, nothing to install (against the computer only: network
games need the app). Or get the latest build from [Releases](https://github.com/i5o/exploding-nerds/releases/latest).

- **Mac** (macOS 14+, Apple Silicon or Intel): unzip and open `Exploding Nerds.app`. It isn't notarized, so macOS
  blocks the first launch: go to System Settings > Privacy & Security and click Open Anyway.
- **Windows**: unzip and run `Exploding Nerds.exe`, from the `(ARM)` folder on ARM PCs. If SmartScreen warns, click
  More info > Run anyway.
- **Linux**: extract and run `./exploding-nerds`, from the `(ARM)` folder on ARM. On Ubuntu 24.04 and later it won't
  start until you run this once in its folder (or start it with `--no-sandbox`):

  ```bash
  sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox
  ```

## Playing on a network

One player hosts; everyone else picks the host from the server list or types its IP. Hosting uses TCP port 47800 and
Bonjour (mDNS) to be found. The first time, macOS and Windows ask for network access: allow it.

## Building

Needs macOS with the Xcode Command Line Tools and Node.js 24.

```bash
node test.js          # rules checks plus 3000 bot-only games
./build.sh            # build/Exploding Nerds - Mac.zip
./electron/build.sh   # build/Exploding Nerds - Windows.zip and - Linux.tar.gz
```

CI runs the same on every pull request, and every push to `main` publishes a release.

## License

Code: MIT. The Exploding Nerds name, art, logo and manuals are Dualboot Partners', used with permission and excluded;
see [LICENSE](LICENSE).
