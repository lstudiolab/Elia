# Elia AI

A responsive, minimalist AI chat interface powered by Groq. The Groq credential stays on the server and is never sent to the browser.

## Features

- Free-form chat with multi-turn conversation context
- Responsive desktop and mobile interface
- Local conversation history saved in the current browser
- Start a new chat, clear a conversation, and export a chat as a text file
- Suggested prompts and typing/loading states
- Server-side Groq API proxy, timeout handling, and friendly error messages

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
