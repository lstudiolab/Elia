import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT) || 3000;
const root = path.dirname(fileURLToPath(import.meta.url));
const defaultModel = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const complexModel = process.env.GROQ_COMPLEX_MODEL || "openai/gpt-oss-120b";

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(root, "public"), { extensions: ["html"] }));

app.get("/api/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    configured: Boolean(process.env.GROQ_API_KEY),
    model: defaultModel,
    complexModel
  });
});

// Feedback is tracked per response for this running service instance.
// The minute heartbeat is deliberately emitted even when no feedback has been received.
const feedbackByMessage = new Map();
const feedbackTotals = { up: 0, down: 0 };

setInterval(() => {
  console.log("[feedback heartbeat] " + JSON.stringify({
    timestamp: new Date().toISOString(),
    total: feedbackByMessage.size,
    thumbsUp: feedbackTotals.up,
    thumbsDown: feedbackTotals.down
  }));
}, 60_000).unref();

app.post("/api/feedback", (req, res) => {
  res.set("Cache-Control", "no-store");
  const messageId = typeof req.body?.messageId === "string" ? req.body.messageId.slice(0, 160) : "";
  const vote = req.body?.vote;
  if (!messageId || !["up", "down"].includes(vote)) {
    return res.status(400).json({ error: "A message ID and valid feedback vote are required." });
  }

  const previous = feedbackByMessage.get(messageId);
  if (previous === vote) return res.json({ ok: true, ...getFeedbackSummary() });
  if (previous) feedbackTotals[previous] -= 1;
  feedbackByMessage.set(messageId, vote);
  feedbackTotals[vote] += 1;
  console.log("[feedback received] " + JSON.stringify({ messageId, vote, ...getFeedbackSummary() }));
  return res.json({ ok: true, ...getFeedbackSummary() });
});

app.get("/api/feedback/summary", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, ...getFeedbackSummary() });
});

function getFeedbackSummary() {
  return { total: feedbackByMessage.size, thumbsUp: feedbackTotals.up, thumbsDown: feedbackTotals.down };
}

function lastUserMessage(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

// A deterministic server-side router keeps trivial exchanges on 20B and sends
// difficult implementation, research, and multi-step work to GPT-OSS 120B.
function shouldUseComplexModel(messages) {
  const current = lastUserMessage(messages);
  const followUp = /^(continue|go on|do it|proceed|finish it|implement it|make it|fix it|now do that)[.!\s]*$/i.test(current.trim());
  const recentContext = messages.slice(-8).map((message) => message.content).join("\n");
  const target = followUp ? recentContext : current;
  let score = 0;

  if (/\b(deep research|comprehensive|in-depth|step[- ]by[- ]step|multi[- ]step|end[- ]to[- ]end|from scratch|production[- ]ready|full implementation|complete implementation|root cause|system architecture|refactor|debug|optimi[sz]e|migration|prove|derive|investigate|research|architect)\b/i.test(target)) score += 2;
  if (/\b(build|implement|design|analy[sz]e|compare|integrate|deploy|create|write|plan)\b/i.test(current)) score += 1;
  if (/\b(codebase|repository|compiler|backend|frontend|database schema|distributed|algorithm|multiple files|entire application|full project)\b/i.test(target)) score += 1;
  if (/\b(and then|after that|in addition|also make sure|multiple requirements|all of the following)\b/i.test(current)) score += 1;
  if (current.length >= 1200) score += 1;
  const actionCount = (current.match(/\b(build|create|implement|design|test|deploy|document|debug|refactor|integrate|optimi[sz]e)\b/gi) || []).length;
  if (actionCount >= 3) score += 1;

  return score >= 2;
}

// Browser search is enabled only when it can materially improve freshness or evidence.
// Groq executes the built-in browser_search tool server-side when required.
function shouldUseWebSearch(messages) {
  const current = lastUserMessage(messages);
  const lower = current.toLowerCase();
  const explicitSearch = /\b(web\s*search|websearch|search (the )?(web|internet|online)|browse (the )?web|look up online|find online|deep research|fact[- ]?check|verify (this|these|whether|if)|provide sources|with citations|cite sources|research (this|the|current|latest)?|search for)\b/i.test(current);
  const freshness = /\b(latest|most recent|currently|current status|today|tonight|right now|this week|this month|recent news|breaking|price|pricing|availability|release date|new version|updated version|schedule|election|regulation|regulations|law|legal requirements|weather|exchange rate|stock price|CEO|president|launch|released|releases|2026|2025)\b/i.test(lower);
  const dynamicTopic = /\b(product recommendation|compare products|software library|API documentation|version support|company policy|travel|restaurant|hotel|event|public figure|market|economic indicator|security advisory|vulnerability|scientific development)\b/i.test(lower);
  return explicitSearch || freshness || dynamicTopic;
}

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
    const role = ["user", "assistant"].includes(message?.role) ? message.role : "user";
    return { role, content: String(message?.content ?? "").slice(0, 12000) };
  }).filter((message) => message.content.trim());

  if (!messages.length || !messages.some((message) => message.role === "user")) {
    return res.status(400).json({ error: "Include a non-empty user message." });
  }

  const requestStartedAt = Date.now();
  try {
    const systemPrompt = (await readFile(path.join(root, "systempromt.md"), "utf8")).trim();
    if (!systemPrompt) {
      return res.status(500).json({ error: "Elia's system instructions are empty. Check systempromt.md." });
    }

    const selectedComplexModel = shouldUseComplexModel(messages);
    const selectedModel = selectedComplexModel ? complexModel : defaultModel;
    const useWebSearch = shouldUseWebSearch(messages);
    const groqMessages = [
      { role: "system", content: systemPrompt },
      ...messages.filter((message) => message.role !== "system")
    ];
    const requestBody = {
      model: selectedModel,
      messages: groqMessages,
      temperature: 1,
      reasoning_effort: selectedComplexModel ? "high" : "medium",
      max_completion_tokens: selectedComplexModel ? 16384 : 8192,
      stream: false
    };

    if (useWebSearch) {
      requestBody.tools = [{ type: "browser_search" }];
      requestBody.tool_choice = "required";
    }

    const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(useWebSearch ? 120000 : 90000)
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

    const durationMs = Date.now() - requestStartedAt;
    const totalTokens = Number.isFinite(data?.usage?.total_tokens) ? data.usage.total_tokens : null;
    return res.json({
      reply,
      model: data.model || selectedModel,
      modelRoute: selectedComplexModel ? "complex" : "standard",
      webSearchUsed: useWebSearch,
      durationMs,
      totalTokens
    });
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
