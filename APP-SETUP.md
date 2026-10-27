# BGH LIVE Controller app: build and install

GitHub builds the installer for you, the same way it built the plug-in. Plan on about 20 minutes tonight
(Parts A–B) and 15 minutes at church (Parts C–D).

---

## Part A: Put the app on GitHub (tonight)

1. Unzip **bgh-live-controller-app.zip** on your computer. You'll get a folder named
   `bgh-live-controller-app`.
2. On **github.com**, click the **+** at the top right, then **New repository**.
   - **Repository name:** `bgh-live-controller`
   - Leave it **Public** (or Private; either works).
   - Don't tick "Add a README". Click **Create repository**.
3. On the new, empty repository's page, click the link **uploading an existing file**.
4. Open the unzipped folder and select **everything inside it** (not the folder itself): the `app`, `build`,
   `src` and `tools` folders and all the files. Drag them onto GitHub's upload page.
   Wait for every file to finish uploading, then click **Commit changes**.
5. **Add the build instructions.** Your computer may hide the `.github` folder, so make this one file by hand:
   - Click **Add file → Create new file**.
   - In the name box, type exactly: `.github/workflows/build.yml`
     (typing the `/` makes the folders as you go).
   - Open `.github/workflows/build.yml` from the unzipped folder in Notepad (on a Mac, TextEdit), copy all of
     it, and paste it into GitHub's big text box. If you can't find the file, copy it from the **build.yml**
     section at the end of this guide.
   - Click **Commit changes** (twice, if it asks again).

## Part B: Let GitHub build the installer (tonight)

6. Click the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
7. Open the newest run, named **Build installer**. It takes about 5–10 minutes.
   - **Green check:** scroll to **Artifacts** at the bottom and download
     **BGH-LIVE-Controller-installer**. It's a .zip with `BGH-LIVE-Controller-Setup-1.0.0.exe` inside.
     Put it on a USB stick or in cloud storage for tomorrow.
   - **Red X:** click the failed job, expand the step with the red X, and send Claude the error lines.

**Bring your settings along (optional):** if you set up speakers or scene collections in the prototype, open
its Settings → Backup → Export settings, copy the text, and save it in Notepad as
`BGH LIVE Controller settings.json`. Bring it with the installer.

## Part C: Install on the church laptop (tomorrow)

8. Install the plug-in first (SETUP-GUIDE.md, Parts E–F) and check OBS's log.
9. Unzip the installer download and double-click **BGH-LIVE-Controller-Setup-1.0.0.exe**.
   - Windows will probably say **"Windows protected your PC"**, because the installer isn't signed with a paid
     certificate. Click **More info → Run anyway**.
   - It installs for your Windows account only, so it doesn't need the administrator password. It adds
     **BGH LIVE Controller** to the Start menu and the desktop.

## Part D: First start (tomorrow)

10. **In OBS:** open **Tools → WebSocket Server Settings**. Tick **Enable WebSocket server**, then click
    **Show Connect Info** and note the **Server Password**. Click **OK**.
11. **Open BGH LIVE Controller.** A red banner says it can't reach OBS yet. That's expected: it doesn't know
    the password. Click **Connection settings** on the banner, enter the password, and press **Apply**.
    The banner goes away within a few seconds, and your scenes appear.
12. **Settings → Backup → Import settings** if you brought your settings file.
13. **Settings → Scene collections:** for each scene collection, choose the speakers text source, schedule
    image source, audio input and Waiting scenes (or None), then press **Apply**.
14. **Settings → Screen:** choose the monitor the controller should open on.
15. **Settings → Connection:** turn on **Open the controller when OBS starts**, if you want that.
16. Work through the test plan, Stages 2–4, with every Go Live test set to **Private**.

## Updating the app later

Updates install themselves (from version 1.2.0 on):

- **The controller:** when a new version is published, the controller downloads it in the background and an
  **UPDATE READY** button appears at the top. Tap it to restart into the new version (about 10 seconds; OBS
  keeps running and streaming). If you don't, it installs by itself the next time the controller is closed.
- **The OBS plug-in:** when there's a new plug-in, the controller asks **OBS plug-in update ready → Update now**.
  It closes OBS the normal way, puts in the new plug-in (with its designs and fonts) and opens OBS again.
  It never does this while you're live or recording; it asks again after the service.
  The first time, Windows asks for permission once, to remove the copy that was installed by hand.
- **Settings → Connection → Updates** shows both versions and has **Check for updates** and **Update now**.

How a change gets published: Claude pushes it to GitHub and raises the version number in `package.json`.
GitHub builds the installer and publishes it as a release; the plug-in repository publishes each plug-in build
the same way (its "plugin-latest" release). Without a new version number, a change is built but not offered
as an update.

## Viewer count (one-time setup)

From version 1.2.8, a count of people watching on YouTube sits beside LIVE while streaming. It needs a free
YouTube API key:

1. Go to **console.cloud.google.com** and sign in (any Google account will do).
2. Create a project (for example "BGH LIVE"), then open **APIs & Services → Library**, find
   **YouTube Data API v3** and press **Enable**.
3. Open **APIs & Services → Credentials → Create credentials → API key** and copy the key.
4. In the controller: **Settings → Going live → Viewer count**. Paste the channel's address or @handle and the
   key, press **Test**, then **Apply**.

A one-hour service uses about 250 of the 10,000 units YouTube gives free each day. The key is saved encrypted and
never goes in a backup. YouTube gives no count for unlisted or private streams, or when the channel hides it;
the pill then shows a dash and tapping it says why.

## Simple mode on the touchscreen

With two screens plugged in, the full controller stays on the main monitor and the touchscreen shows **Simple mode**:
the Program picture, the mic bar, big scene buttons, Go Live and Record (with End and Stop built in), Safe mode,
and Hymn, Bible and Names. With only one screen, it's just the full controller.

- The first time it opens, Simple mode remembers that screen as the touchscreen, so a projector or TV plugged in later
  never gets it. To change it, use **Settings → Screen → The touchscreen for Simple mode**.
- **Go Live** and everything in **Menu** (Slideshow, Ready check, Phone remote, Scene collection, Settings) bring the
  full controller onto the touchscreen. It goes back to the main monitor when that's closed, or tap
  **Back to Simple mode** at the top. **Menu → Full controller** keeps it there until you tap that button.
- Unplug the touchscreen and Simple mode closes; plug it back in and it opens again.
- To turn it off, untick **Settings → Screen → Simple mode on the touchscreen**.

## Ready check

The double-tick button beside Safe mode checks Camera 1 (picture, no-signal screen, unplugged, asleep, wrong
device), the microphone, OBS's YouTube sign-in and disk space. A red dot appears on it when something needs
attention; tap it for what's wrong and the buttons that fix it.

## Phone remote

A phone on the church Wi-Fi can change scenes, mute the mic, show hymns, Bible verses and lower thirds, and
watch a small picture of Program. Going live, stopping and recording stay on the controller.

1. On the controller: **Settings → Phone remote**, turn on **Turn on the phone remote**.
2. The first time, Windows asks whether BGH LIVE Controller can use the network: tick **Private networks**
   and choose **Allow**. (If the church Wi-Fi is set as a *Public* network in Windows, change it to *Private*:
   Settings → Network & internet → Wi-Fi → the network → Private network.)
3. On the phone (iPhone or Android, any browser): point the camera at the QR code on that page, or type the
   address shown there (like `http://192.168.1.20:8642`). Type the 3-digit pairing code if it asks.
4. Optional: in Safari, Share → **Add to Home Screen**, so it opens like an app.

- The code only works while Settings → Phone remote is open, and changes after each phone pairs.
  Five wrong codes pause pairing for 5 minutes.
- A paired phone stays paired. Remove it in Settings → Phone remote and it stops working straight away.
- Only phones on the same network can reach it. If the laptop's address changes (a new Wi-Fi router, say),
  open the new address shown in Settings; the phone stays paired.
- With **View program** on, the phone gets a small picture (320×180, about 10 KB) every 3 seconds, and only
  while its screen is on.

## Where things are kept on the laptop

- Settings, speakers and automatic backups: `%APPDATA%\BGH LIVE Controller`
- The OBS password: in the same folder, encrypted by Windows so only your Windows account can read it
- The "open with OBS" setting the plug-in reads: `%APPDATA%\BGH LIVE Controller\open-with-obs.json`
- Paired phones (each phone's key, stored scrambled) and whether the phone remote is on: `%APPDATA%\BGH LIVE Controller\phone-remote.json`
- The OBS plug-in, as the controller installs it: `C:\ProgramData\obs-studio\plugins\church-controller`

---

## build.yml

```yaml
# Builds the Windows installer every time something is committed.
# The installer appears under Actions → the newest run → Artifacts.
# On main, a new version number is also published as a GitHub release, which is where the controller
# looks for updates: it downloads them by itself and shows "Update ready".
name: Build installer
on:
  push:
  workflow_dispatch:
permissions:
  contents: write
jobs:
  windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - name: Install
        run: npm ci
      - name: Build the installer
        run: npm run dist
      - name: Upload the installer
        uses: actions/upload-artifact@v4
        with:
          name: BGH-LIVE-Controller-installer
          path: dist/*.exe
          if-no-files-found: error
      - name: Publish the update
        if: github.ref == 'refs/heads/main'
        shell: pwsh
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
          $tag = "v$version"
          gh release view $tag 2>$null | Out-Null
          if ($LASTEXITCODE -eq 0) {
            Write-Host "Version $version is already published. Change the version in package.json to publish an update."
            exit 0
          }
          $files = @(Get-ChildItem dist/*.exe, dist/*.exe.blockmap, dist/latest.yml | ForEach-Object { $_.FullName })
          if ($files.Count -lt 3) { Write-Error "The installer, its blockmap or latest.yml is missing"; exit 1 }
          gh release create $tag @files --title "BGH LIVE Controller $version" --notes "Installed automatically: the controller downloads this update and shows Update ready."
          if ($LASTEXITCODE -ne 0) { exit 1 }
```
