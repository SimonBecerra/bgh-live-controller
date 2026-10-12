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

Change the files in the `bgh-live-controller` repository (Claude will tell you which), wait for the green
check under **Actions**, download the new installer, and run it on the church laptop. It installs over the old
version and keeps all your settings and your saved password.

## Where things are kept on the laptop

- Settings, speakers and automatic backups: `%APPDATA%\BGH LIVE Controller`
- The OBS password: in the same folder, encrypted by Windows so only your Windows account can read it
- The "open with OBS" setting the plug-in reads: `%APPDATA%\BGH LIVE Controller\open-with-obs.json`

---

## build.yml

```yaml
# Builds the Windows installer every time something is committed.
# The installer appears under Actions → the newest run → Artifacts.
name: Build installer
on:
  push:
  workflow_dispatch:
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
```
