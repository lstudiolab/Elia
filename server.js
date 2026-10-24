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
function isCodingOrDebuggingTask(messages) {
  const current = lastUserMessage(messages);
  const recentContext = messages.slice(-6).map((message) => message.content).join("\\n");
  const target = current.length < 100 && /\\b(it|that|those|this|these|the bug|the error|the code|the fix|the issue)\\b/i.test(current)
    ? recentContext
    : current;

  // Treat concrete code changes, errors, and debugging as complex work rather than
  // waiting for a broad complexity score to accumulate.
  return /\\b(cod(e|ing)|program(ming)?|debug(ging)?|bug|fix|error|exception|stack trace|compile(r|s|d|ing)?|syntax|runtime|not working|doesn.t work|broken|fails? to|failing|crash(es|ed|ing)?|refactor|implement|codebase|repository|script|function|class|api endpoint|server.js|index.html|typescript|javascript|python|c\\+\\+|rust|swift|lua|html|css|sql|git(hub)?|pull request|patch|regression|test failure)\\b/i.test(target);
}

function shouldUseComplexModel(messages) {
  if (isCodingOrDebuggingTask(messages)) return true;

  const current = lastUserMessage(messages);
  const followUp = /^(continue|go on|do it|proceed|finish it|implement it|make it|make all of that|make everything|fix it|now do that|apply those changes|do all of that|handle the rest)[.!\\s]*$/i.test(current.trim());
  const recentContext = messages.slice(-8).map((message) => message.content).join("\\n");
  const target = followUp || (current.length < 90 && /\\b(it|that|those|these|everything|all of it|the changes)\\b/i.test(current)) ? recentContext : current;
  let score = 0;

  if (/\\b(deep research|comprehensive|in-depth|step[- ]by[- ]step|multi[- ]step|end[- ]to[- ]end|from scratch|production[- ]ready|full implementation|complete implementation|root cause|system architecture|refactor|debug|optimi[sz]e|migration|prove|derive|investigate|research|architect)\\b/i.test(target)) score += 2;
  if (/\\b(build|implement|design|analy[sz]e|compare|integrate|deploy|create|write|plan|configure|rewrite|migrate)\\b/i.test(current)) score += 1;
  if (/\\b(codebase|repository|compiler|backend|frontend|database schema|distributed|algorithm|multiple files|entire application|full project)\\b/i.test(target)) score += 1;
  if (/\\b(and then|after that|in addition|also make sure|multiple requirements|all of the following)\\b/i.test(current)) score += 1;
  if (current.length >= 800) score += 1;
  const actionCount = (current.match(/\\b(build|create|implement|design|test|deploy|document|debug|refactor|integrate|optimi[sz]e|make|write|add|remove|delete|configure|update|change|specify|clarify|compare|research|explain|analy[sz]e|plan|connect|migrate)\\b/gi) || []).length;
  if (actionCount >= 3) score += 2;
  else if (actionCount >= 2) score += 1;
  const requirementCount = (current.match(/\\b(and|also|plus|then|while|including|as well as)\\b/gi) || []).length;
  if (requirementCount >= 3) score += 1;

  return score >= 2;
}

function shouldEscalateWeakAnswer(messages, reply) {
  if (!reply || !reply.trim()) return true;
  if (!isCodingOrDebuggingTask(messages)) return false;

  const answer = reply.trim();
  const explicitFailure = /\\b(i can.t|i cannot|i\\u2019m unable|i am unable|unable to (fix|solve|debug|implement|determine)|i don.t know how|cannot help with this|not enough information to (fix|solve)|i couldn.t resolve)\\b/i.test(answer);
  const tooShortToBeUseful = answer.length < 180 && !/\\b(no code changes needed|the issue is|the fix is|change .* to|replace .* with)\\b/i.test(answer);
  return explicitFailure || tooShortToBeUseful;
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
    const useWebSearch = shouldUseWebSearch(messages);
    const groqMessages = [
      { role: "system", content: systemPrompt },
      ...messages.filter((message) => message.role !== "system")
    ];

    async function requestCompletion(model, isComplex) {
      const requestBody = {
        model,
        messages: groqMessages,
        temperature: 1,
        reasoning_effort: "high",
        max_completion_tokens: isComplex ? 16384 : 8192,
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
        const error = new Error(upstream.status === 429
          ? "The AI service is busy or rate-limited. Wait a moment and try again."
          : "The AI provider rejected the request. Check the server's Groq configuration.");
        error.status = upstream.status === 429 ? 429 : 502;
        throw error;
      }

      return { data, reply: data?.choices?.[0]?.message?.content };
    }

    let actualModel = selectedComplexModel ? complexModel : defaultModel;
    let actualRoute = selectedComplexModel ? "complex" : "standard";
    let completion;

    try {
      completion = await requestCompletion(actualModel, selectedComplexModel);
    } catch (error) {
      if (selectedComplexModel) throw error;
      throw error;
    }

    // If a standard-model response clearly fails at a coding task, automatically
    // retry once on 120B. Never retry a request that already used the complex model.
    if (!selectedComplexModel && shouldEscalateWeakAnswer(messages, completion.reply)) {
      console.warn("[model escalation] Standard response was insufficient; retrying with complex model.", JSON.stringify({
        initialModel: actualModel,
        retryModel: complexModel,
        reason: "weak_coding_response"
      }));
      try {
        completion = await requestCompletion(complexModel, true);
        actualModel = complexModel;
        actualRoute = "complex_fallback";
      } catch (error) {
        console.error("[model escalation] Complex-model retry failed.");
        // Preserve the initial response if the fallback request itself fails.
      }
    }

    const { data } = completion;
    const reply = completion.reply;
    if (typeof reply !== "string" || !reply.trim()) {
      return res.status(502).json({ error: "The AI provider returned an empty response." });
    }

    const durationMs = Date.now() - requestStartedAt;
    const totalTokens = Number.isFinite(data?.usage?.total_tokens) ? data.usage.total_tokens : null;
    console.log("[model route] " + JSON.stringify({
      requestedRoute: selectedComplexModel ? "complex" : "standard",
      actualRoute,
      model: data.model || actualModel,
      webSearch: useWebSearch
    }));
    return res.json({
      reply,
      model: data.model || actualModel,
      modelRoute: actualRoute,
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
