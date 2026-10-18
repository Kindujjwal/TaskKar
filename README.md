
# TaskKar

A calm, private space to organize your day. TaskKar is an offline-first productivity app that brings together todos, notes, and a focus timer in one simple experience. It is built as a Progressive Web App (PWA) with Android APK support.

## Features

- **Todo management:** Create, edit, complete, and organize tasks.
- **Due dates and times:** Schedule tasks for today, tomorrow, or a custom date and time.
- **Notes:** Write and edit personal notes in one place.
- **Focus timer:** Choose 25-minute or 50-minute sessions, or set a custom duration from 1 to 720 minutes. Start, pause, and reset sessions.
- **Search:** Find tasks and notes quickly.
- **Trash and restore:** Recover deleted items or permanently remove them.
- **Offline support:** Access the app and saved data without an internet connection after setup and caching.
- **Installable PWA:** Install TaskKar on supported devices for an app-like experience.
- **Android support:** A signed APK is available for Android distribution.
- **Local-first privacy:** Todos and notes are stored on your device, not sent to a remote application server.
- **Responsive interface:** A minimal dark interface designed for everyday use.

## Screenshots

<img width="1164" height="490" alt="image" src="https://github.com/user-attachments/assets/c10ef4c4-b96e-4354-974f-e9e868d05a08" />


<!-- Add screenshots from the screenshots/ folder here. -->

## Getting Started

### Use TaskKar

1. Open the deployed TaskKar website in a supported browser.
2. Install the app if the browser offers the installation option.
3. Create tasks, write notes, or start a focus session.


## Privacy

TaskKar is designed around local storage:

- Todos and notes are stored locally in the browser using IndexedDB.
- Focus timer settings are saved in local storage.
- Your saved tasks and notes are not uploaded to a TaskKar application server.
- Clearing browser data or uninstalling an app may remove locally stored information. Keep your own backups if the data matters to you.

## Tech Stack

- HTML5
- CSS3
- Vanilla JavaScript
- IndexedDB for tasks and notes
- Local Storage for focus timer state
- Service Worker for offline caching
- Web App Manifest for PWA installation

## Project Structure

```text
TaskKar/
├── fonts/
├── icons/
├── screenshots/
├── app.js
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── styles.css
└── README.md
```

## Contributing

Contributions, suggestions, and bug reports are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Make your changes and test the app.
4. Submit a pull request describing your changes.

For bugs or feature requests, open an issue in the GitHub repository.

## Support the Project

If TaskKar is useful to you, you can support its creator:

- [Buy me a chai](https://www.buymeachai.in/kindujjwal)
- [GitHub profile](https://github.com/kindujjwal)
---
## Author

**Ujjwal**

- GitHub: [@Kindujjwal](https://github.com/Kindujjwal)
- Repository: [TaskKar](https://github.com/Kindujjwal/TaskKar)

---

Made for a calmer, more focused day.
