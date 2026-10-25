# Elia AI

A responsive, minimalist AI chat interface powered by Groq. The Groq credential stays on the server and is never sent to the browser.

## Features

- Free-form multi-turn chat powered by a server-side Groq API proxy
- Siri-inspired conversation library with masonry cards, grid/list layouts, full-history search, pinning, renaming, individual deletion, and bulk deletion
- Local history using localStorage and IndexedDB, plus optional PostgreSQL-backed snapshots through `DATABASE_URL`
- Export/import of conversation backups, including conversation titles, messages, attachment metadata, model/thinking selection, and UI preferences
- Saved preferences for startup view, retention (forever/1 year/30 days), card preview length, light/dark/system appearance, reduced motion, and reduced transparency
- Liquid Glass-inspired web styling for navigation and controls, with subtle pointer highlights, responsive transitions, and reduced-motion/transparency fallbacks
- Browser speech dictation, a dedicated animated voice orb view, and spoken assistant responses where browser speech APIs are supported
- Markdown rendering, horizontally scrollable tables, inline images, attachment previews, response feedback, suggested prompts, and typing states
- Server-side API proxy, timeout/error handling, and health status without exposing the Groq credential

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
cp .env.example .env
```

Open `.env` and set your Groq key:

```env
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
```

Then start the app:

```sh
npm start
```

Visit http://localhost:3000.

Never commit `.env` or put the Groq key in browser code. If a key has been pasted into a chat, terminal transcript, or public location, rotate it in the Groq console.

## Deploy on Render

This repository includes a `render.yaml` Blueprint. You can create a new Render Web Service from this repo or use the Render dashboard:

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Set `GROQ_API_KEY` as a secret environment variable in Render
- Optional: set `GROQ_MODEL` to a Groq-supported chat model

The service uses Render's injected `PORT` value automatically. `/api/health` reports whether a key is configured without exposing the key.

## API

- `GET /api/health` — health and configuration status
- `POST /api/chat` — body: `{ "messages": [{ "role": "user", "content": "Hello" }] }`

The chat endpoint validates message count and size, keeps the API key server-side, and forwards requests to Groq's OpenAI-compatible chat completions endpoint.

## Conversation backup, preferences, and privacy notes

- Backups are JSON files exported from **Settings**. Treat them as private: they contain conversation text and a sync key used to identify the cloud-history snapshot.
- Import merges conversations by ID and favors the version with the newer `updatedAt` timestamp. Imported content is sanitized before it is rendered.
- The optional retention setting deletes conversations older than the selected period after confirmation. This is permanent.
- Voice dictation and read-aloud rely on browser speech APIs and microphone permission; availability varies by browser and operating system.
- The glass effect is a CSS approximation for a web app. It cannot reproduce native Apple Liquid Glass rendering or access private Siri integrations, iCloud credentials, personal Apple-app data, or system-wide iOS actions.

## Persistent conversation history

Conversation messages and their library cards are saved in the browser immediately, with IndexedDB as a local backup. To preserve history through browser-data loss and make it available again from the same device ID, configure `DATABASE_URL` on the Render service to point to a persistent PostgreSQL database. The server creates its `elia_conversation_snapshots` table automatically. The Render Blueprint declares `DATABASE_URL` as a secret environment variable; add the connection string in the Render Dashboard. Without it, cloud history is unavailable and history is limited to that browser's local storage.
