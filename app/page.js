"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { APP_NAME, SUGGESTIONS } from "../lib/config.js";

const STORAGE_KEY = "rachits-assistant-conversation";

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function AssistantAvatar() {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neutral-500 to-neutral-800 text-xs font-semibold text-white shadow-sm"
    >
      R
    </span>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex h-7 items-center gap-1.5" aria-label="Typing">
      <span className="typing-dot h-2 w-2 rounded-full bg-neutral-500" />
      <span className="typing-dot h-2 w-2 rounded-full bg-neutral-500" />
      <span className="typing-dot h-2 w-2 rounded-full bg-neutral-500" />
    </span>
  );
}

function MarkdownMessage({ content }) {
  return (
    <div className="markdown-body min-w-0 break-words text-base leading-[1.6]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="markdown-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeAssistantId, setActiveAssistantId] = useState(null);
  const [errorType, setErrorType] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const textareaRef = useRef(null);
  const bottomRef = useRef(null);
  const abortRef = useRef(null);
  const activeRef = useRef(false);
  const touchInputRef = useRef(false);

  useEffect(() => {
    touchInputRef.current = window.matchMedia("(pointer: coarse)").matches;
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setMessages(
            parsed.filter(
              (message) =>
                message &&
                (message.role === "user" || message.role === "assistant") &&
                typeof message.content === "string",
            ),
          );
        }
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    }
  }, [hydrated, messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [messages, errorType]);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const lineHeight = Number.parseFloat(
      window.getComputedStyle(textarea).lineHeight,
    );
    const maxHeight = (lineHeight || 25.6) * 6;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [draft, resizeTextarea]);

  const sendMessage = useCallback(
    async (rawText, retryUser = null) => {
      const content = rawText.trim();
      if (!content || activeRef.current) return;

      activeRef.current = true;
      const assistantId = createId();
      const userMessage = retryUser || {
        id: createId(),
        role: "user",
        content,
      };
      const userIndex = retryUser
        ? messages.findIndex((message) => message.id === retryUser.id)
        : -1;
      const history = retryUser
        ? messages.slice(0, userIndex + 1)
        : [...messages, userMessage];
      const assistantMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
      };

      setMessages([...history, assistantMessage]);
      setDraft("");
      setErrorType(null);
      setIsStreaming(true);
      setActiveAssistantId(assistantId);
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history
              .slice(-8)
              .map(({ role, content: messageContent }) => ({
                role,
                content: messageContent,
              })),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let failure;
          try {
            failure = await response.json();
          } catch {
            failure = null;
          }
          setMessages((current) =>
            current.filter((message) => message.id !== assistantId),
          );
          setErrorType(
            response.status === 429 || failure?.error === "rate_limited"
              ? "rate_limited"
              : "server_error",
          );
          return;
        }

        if (!response.body) throw new Error("missing_stream");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let responseText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          responseText += decoder.decode(value, { stream: true });
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: responseText }
                : message,
            ),
          );
        }

        const remainder = decoder.decode();
        if (remainder) {
          responseText += remainder;
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: responseText }
                : message,
            ),
          );
        }
      } catch (error) {
        if (error?.name === "AbortError") {
          setMessages((current) =>
            current.filter(
              (message) =>
                message.id !== assistantId || message.content.length > 0,
            ),
          );
        } else {
          setMessages((current) =>
            current.filter((message) => message.id !== assistantId),
          );
          setErrorType("server_error");
        }
      } finally {
        activeRef.current = false;
        abortRef.current = null;
        setIsStreaming(false);
        setActiveAssistantId(null);
      }
    },
    [messages],
  );

  const submitDraft = useCallback(
    (event) => {
      event?.preventDefault();
      void sendMessage(draft);
    },
    [draft, sendMessage],
  );

  const retryLastMessage = useCallback(() => {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (lastUser) void sendMessage(lastUser.content, lastUser);
  }, [messages, sendMessage]);

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setDraft("");
    setErrorType(null);
    setCopiedId(null);
    window.localStorage.removeItem(STORAGE_KEY);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, []);

  const stopGenerating = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const copyMessage = useCallback(async (message) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setCopiedId(null);
    }
  }, []);

  const handleComposerKeyDown = useCallback(
    (event) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !touchInputRef.current
      ) {
        event.preventDefault();
        submitDraft(event);
      }
    },
    [submitDraft],
  );

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden bg-[var(--page)] text-[var(--text)]">
      <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--page)]/95 px-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full bg-gradient-to-br from-neutral-400 to-neutral-800 shadow-sm"
            />
            <span className="truncate text-[15px] font-semibold tracking-[-0.015em]">
              {APP_NAME}
            </span>
          </div>
          <button
            type="button"
            onClick={startNewChat}
            className="ml-4 flex min-h-11 shrink-0 items-center gap-2 rounded-full px-3 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:focus-visible:ring-offset-neutral-900"
            aria-label="New chat"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              className="h-[18px] w-[18px]"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>New chat</span>
          </button>
        </div>
      </header>

      <main
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6"
        aria-live="polite"
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
          {!hydrated ? (
            <div className="flex flex-1 items-center justify-center" aria-label="Loading conversation">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700 dark:border-neutral-700 dark:border-t-neutral-200" />
            </div>
          ) : messages.length === 0 ? (
            <section className="flex flex-1 flex-col justify-center py-10 sm:py-16">
              <div className="mx-auto w-full max-w-2xl">
                <h1 className="text-center text-[2rem] font-semibold leading-tight tracking-[-0.04em] sm:text-[2.75rem]">
                  Namaste Rachit 👋
                </h1>
                <p className="mt-3 text-center text-base text-neutral-500 dark:text-neutral-400 sm:text-lg">
                  Aaj main tumhari kya madad karun?
                </p>
                <div className="mt-9 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void sendMessage(suggestion)}
                      disabled={isStreaming}
                      className="min-h-[68px] rounded-2xl border border-[var(--border)] bg-[var(--surface-raised)] px-4 py-3 text-left text-[15px] leading-snug text-neutral-700 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-colors hover:bg-[var(--surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-200 dark:focus-visible:ring-offset-neutral-900"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ) : (
            <section className="flex flex-col gap-8 py-8 sm:gap-10 sm:py-10">
              {messages.map((message, index) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[88%] rounded-[1.4rem] bg-neutral-100 px-4 py-3 text-base leading-[1.6] text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100 sm:max-w-[78%] sm:px-5">
                      <p className="whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                    </div>
                  </div>
                ) : (
                  <article
                    key={message.id}
                    className="flex min-w-0 items-start gap-3 sm:gap-4"
                  >
                    <AssistantAvatar />
                    <div className="min-w-0 flex-1 pt-1">
                      {message.content ? (
                        <>
                          <MarkdownMessage content={message.content} />
                          {isStreaming && message.id === activeAssistantId ? (
                            <span className="stream-cursor" aria-hidden="true" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => void copyMessage(message)}
                              className="mt-3 flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                              aria-label={`Copy assistant message ${index + 1}`}
                            >
                              <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                fill="none"
                                className="h-4 w-4"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <rect x="8" y="8" width="12" height="12" rx="2" />
                                <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
                              </svg>
                              <span>{copiedId === message.id ? "Copied" : "Copy"}</span>
                            </button>
                          )}
                        </>
                      ) : isStreaming && message.id === activeAssistantId ? (
                        <TypingDots />
                      ) : null}
                    </div>
                  </article>
                ),
              )}
              {errorType ? (
                <div
                  role="alert"
                  className="ml-11 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:ml-12"
                >
                  <p className="text-sm text-neutral-700 dark:text-neutral-200">
                    {errorType === "rate_limited"
                      ? "Free limit abhi full hai. 30-60 second baad dobara try karo."
                      : "Kuch gadbad ho gayi. Dobara try karo."}
                  </p>
                  <button
                    type="button"
                    onClick={retryLastMessage}
                    className="mt-2 flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-neutral-700 underline decoration-neutral-400 underline-offset-4 hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-neutral-200 dark:hover:text-white"
                  >
                    Retry
                  </button>
                </div>
              ) : null}
              <div ref={bottomRef} className="h-px w-full shrink-0" />
            </section>
          )}
        </div>
      </main>

      <footer className="sticky bottom-0 z-20 shrink-0 border-t border-[var(--border)] bg-[var(--page)]/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6 sm:pt-4">
        <div className="mx-auto w-full max-w-3xl">
          <form
            onSubmit={submitDraft}
            className="flex items-end gap-2 rounded-3xl border border-neutral-200 bg-[var(--surface-raised)] p-2 shadow-[0_5px_24px_rgba(0,0,0,0.07)] transition-shadow focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 dark:border-neutral-700 dark:focus-within:border-indigo-500"
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Kuch bhi pucho…"
              aria-label="Message"
              className="max-h-[154px] min-h-11 min-w-0 flex-1 resize-none overflow-y-hidden bg-transparent px-3 py-2.5 text-base leading-[1.6] text-[var(--text)] outline-none placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
            />
            <button
              type={isStreaming ? "button" : "submit"}
              onClick={isStreaming ? stopGenerating : undefined}
              disabled={!isStreaming && !draft.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition-colors hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-500 dark:focus-visible:ring-offset-neutral-900"
              aria-label={isStreaming ? "Stop generating" : "Send message"}
            >
              {isStreaming ? (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-4 w-4"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : (
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="h-5 w-5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              )}
            </button>
          </form>
          <p className="mt-2 text-center text-[11px] leading-4 text-neutral-500">
            AI galti kar sakta hai. Zaroori baaton ko verify karo.
          </p>
        </div>
      </footer>
    </div>
  );
}