# BGH LIVE Controller

Touchscreen controller for OBS Studio at Barrington Gospel Hall (Windows desktop app).

- `src/obs-controller.html`: the controller (the same file as the prototype; prototype-only parts are marked)
- `app/obs-connection.js`: the connection to the real OBS (obs-websocket 5)
- `main.js`, `preload.js`: the desktop app (window, monitors, files, encrypted password, keep awake)
- `tools/build-renderer.mjs`: builds `app/index.html` (removes prototype-only parts, bundles fonts and icons)
- `.github/workflows/build.yml`: GitHub builds the Windows installer on every commit

Needs the companion OBS plug-in (church-controller) for going live from the controller.
