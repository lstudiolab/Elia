import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT) || 3000;
const root = path.dirname(fileURLToPath(import.meta.url));
const defaultModel = "llama-3.3-70b-versatile";

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(root, "public"), { extensions: ["html"] }));

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    configured: Boolean(process.env.GROQ_API_KEY),
    model: process.env.GROQ_MODEL || defaultModel
  });
});

app.post("/api/chat", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "The server is missing its GROQ_API_KEY environment variable." });
  }

  const incoming = req.body?.messages;
  if (!Array.isArray(incoming) || incoming.length < 1 || incoming.length > 80) {
    return res.status(400).json({ error: "Send between 1 and 80 messages." });
  }

  const messages = incoming.map((message) => {
    const role = ["user", "assistant", "system"].includes(message?.role) ? message.role : "user";
    return { role, content: String(message?.content ?? "").slice(0, 12000) };
  }).filter((message) => message.content.trim());

  if (!messages.length || !messages.some((message) => message.role === "user")) {
    return res.status(400).json({ error: "Include a non-empty user message." });
  }

  try {
    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || defaultModel,
        messages,
        temperature: 0.7,
        stream: false
      }),
      signal: AbortSignal.timeout(90000)
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const providerMessage = data?.error?.message;
      console.error("Groq request failed:", upstream.status, providerMessage || "Unknown upstream error");
      const status = upstream.status === 429 ? 429 : upstream.status === 401 || upstream.status === 403 ? 502 : 502;
      return res.status(status).json({
        error: upstream.status === 429
          ? "The AI service is busy or rate-limited. Wait a moment and try again."
          : "The AI provider rejected the request. Check the server's Groq configuration."
      });
    }

    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return res.status(502).json({ error: "The AI provider returned an empty response." });
    }

    return res.json({ reply, model: data.model || process.env.GROQ_MODEL || defaultModel });
  } catch (error) {
    console.error("Chat request failed:", error?.name || "Error");
    return res.status(504).json({ error: "The AI request timed out or could not reach the provider. Try again." });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(root, "public", "index.html"));
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Elia AI listening on port ${port}`);
});
