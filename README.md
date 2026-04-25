# Packsplit

Packsplit is a local web app for building Minecraft modpacks and exporting separate client and server bundles. It helps pack authors search for mods, choose compatible files for a Minecraft version and loader, sort mods by side, and download ready-to-use archives.

## What it does

- Searches Modrinth by default and can also search CurseForge when `CURSEFORGE_API_KEY` is configured.
- Supports Fabric, Forge, NeoForge, and Quilt packs.
- Saves multiple modpacks in the browser with IndexedDB.
- Caches mod search results and downloaded jar files locally in the browser.
- Checks selected mods when the Minecraft version or loader changes and offers compatible updates.
- Splits mods into client-only, server-only, and both-side groups.
- Exports a client zip for players.
- Exports a server zip with `mods/`, generated config files, startup scripts, and Pterodactyl notes.
- Imports existing `.mrpack` and zip-based pack exports.

## Why it uses the CurseForge API

CurseForge projects do not expose direct public download URLs in the same way as Modrinth projects. Packsplit uses a small Express proxy so the browser can search CurseForge and request approved download URLs without exposing the API key to client-side JavaScript.

The key is read from `CURSEFORGE_API_KEY` and is only used by the local server when calling CurseForge API endpoints.

## Requirements

- Node.js 18 or newer
- A CurseForge API key for CurseForge search and downloads

## Setup

Install dependencies:

```bash
npm install
```

Create a local `.env` file when CurseForge support is needed:

```bash
CURSEFORGE_API_KEY=your_api_key_here
```

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

Without a CurseForge key, the app still runs and searches Modrinth.

## Project Structure

```text
server.js          Express server and CurseForge proxy
public/index.html Main app markup
public/app.js     Browser app, pack storage, search, compatibility, exports
public/styles.css App styling
.env.example      Example environment configuration
```

## Notes

Generated modpack zips, backups, logs, `node_modules`, and local `.env` files are intentionally excluded from Git. The repository is meant to contain the application source, not downloaded mod jars or private credentials.
