import Groq from "groq-sdk";
import { SYSTEM_PROMPT } from "../../../lib/config.js";

export const maxDuration = 60;

const MAX_MESSAGES = 8;
const MAX_MESSAGE_CHARACTERS = 8000;

function jsonError(error, status) {
  return Response.json({ error }, { status });
}

function statusOf(error) {
  return error?.status ?? error?.statusCode ?? error?.response?.status;
}

function canRetryWithFallback(error) {
  const status = statusOf(error);
  const errorText = `${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return (
    status === 429 ||
    status === 413 ||
    errorText.includes("model") ||
    errorText.includes("decommissioned")
  );
}

function errorResponse(error) {
  return statusOf(error) === 429
    ? jsonError("rate_limited", 429)
    : jsonError("server_error", 500);
}

function todayInKolkata() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
}

function boundedMessages(messages) {
  const recent = messages.slice(-MAX_MESSAGES).map(({ role, content }) => ({
    role,
    content,
  }));

  const totalCharacters = () =>
    recent.reduce((total, message) => total + message.content.length, 0);

  while (recent.length > 1 && totalCharacters() > MAX_MESSAGE_CHARACTERS) {
    recent.shift();
  }

  if (recent.length === 1 && recent[0].content.length > MAX_MESSAGE_CHARACTERS) {
    recent[0].content = recent[0].content.slice(-MAX_MESSAGE_CHARACTERS);
  }

  return recent;
}

async function openModelStream(apiKey, model, messages) {
  const client = new Groq({ apiKey, maxRetries: 0 });
  const stream = await client.chat.completions.create(
    {
      model,
      messages,
      max_completion_tokens: 1500,
      temperature: 0.6,
      reasoning_effort: "low",
      include_reasoning: false,
      stream: true,
    },
    { maxRetries: 0 },
  );

  const iterator = stream[Symbol.asyncIterator]();
  let firstContent = null;
  let done = false;

  while (!done && !firstContent) {
    const result = await iterator.next();
    done = result.done;
    if (
      !done &&
      typeof result.value?.choices?.[0]?.delta?.content === "string" &&
      result.value.choices[0].delta.content.length > 0
    ) {
      firstContent = result.value;
    }
  }

  return { iterator, firstContent, done };
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("server_error", 400);
  }

  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError("server_error", 400);
  }

  const isValid = body.messages.every(
    (message) =>
      message &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string",
  );

  if (!isValid) {
    return jsonError("server_error", 400);
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return jsonError("server_error", 500);
  }

  const modelMessages = [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}\n\nToday's date in Asia/Kolkata: ${todayInKolkata()}`,
    },
    ...boundedMessages(body.messages),
  ];
  const primaryModel = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  const fallbackModel =
    process.env.GROQ_FALLBACK_MODEL || "openai/gpt-oss-20b";

  let opened;
  try {
    opened = await openModelStream(apiKey, primaryModel, modelMessages);
  } catch (primaryError) {
    if (!canRetryWithFallback(primaryError) || fallbackModel === primaryModel) {
      return errorResponse(primaryError);
    }

    try {
      opened = await openModelStream(apiKey, fallbackModel, modelMessages);
    } catch (fallbackError) {
      return errorResponse(fallbackError);
    }
  }

  const encoder = new TextEncoder();
  const responseStream = new ReadableStream({
    async start(controller) {
      const enqueueContent = (chunk) => {
        const content = chunk?.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          controller.enqueue(encoder.encode(content));
        }
      };

      try {
        if (opened.firstContent) enqueueContent(opened.firstContent);
        let done = opened.done;
        while (!done) {
          const next = await opened.iterator.next();
          done = next.done;
          if (!done) enqueueContent(next.value);
        }
        controller.close();
      } catch {
        controller.error(new Error("stream_failed"));
      }
    },
    cancel() {
      if (typeof opened.iterator.return === "function") {
        void opened.iterator.return();
      }
    },
  });

  return new Response(responseStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}