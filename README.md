# TaskKar

TaskKar is an installable, offline-first todo and notes PWA. Its responsive dark-mode interface works in a browser or as an installed app, with no framework, account, remote API, analytics, or third-party runtime service.

## Run locally

Service workers require a secure context. Start a static file server in the project directory, for example:

```powershell
py -m http.server 8000
```

Open `http://localhost:8000` to use and install the app. On a phone, publish the static files over HTTPS, open the site in a supported browser, and choose **Add to Home Screen** or **Install app**.

Todos support custom due dates and optional local due times. Focus sessions support custom durations from 1 to 720 minutes. The Donation tab links to the creator's Buy Me a Chai page and GitHub profile.

Todos, notes, and focus settings are saved locally in IndexedDB and `localStorage`; the service worker caches the app shell for offline use. Data stays on this device and may be removed if browser site data is cleared. Roboto Serif is bundled under the SIL Open Font License in `fonts/OFL-RobotoSerif.txt`.

## Android APK

`TaskKar-1.0.0.apk` is the signed Android release build. It supports Android 7.0 (API 24) and later and bundles the PWA assets for offline use. The native WebView shell is in `android-app/`.

To rebuild, install JDK 17 and Android SDK Platform 35, then run `./gradlew assembleRelease` from `android-app/`. Release signing reads `TASKKAR_KEYSTORE`, `TASKKAR_KEYSTORE_PASSWORD`, `TASKKAR_KEY_ALIAS`, and `TASKKAR_KEY_PASSWORD` from the environment. Keep the signing keystore and passwords out of source control and back them up privately; future APK updates must use the same signing key.
