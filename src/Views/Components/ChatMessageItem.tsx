import { Component, MarkdownRenderer, Notice, TFile } from "obsidian";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { ChatMessage, EnodiosChatView } from "../EnodiosChatView.tsx";

// Re-importing or redefining necessary interfaces/types
export interface ChatMessageItemProps {
  message: ChatMessage;
  onEdit?: (messageId: string, newContent: string) => void;
  view: EnodiosChatView;
  isEditing?: boolean;
  onStartEdit?: () => void;
  onCancelEdit?: () => void;
}

const HELIX_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function HelixSpinner({
  isRunning,
}: {
  isRunning: boolean;
}): React.ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => {
      setFrame((f) => (f + 1) % HELIX_FRAMES.length);
    }, 80);
    return () => {
      window.clearInterval(interval);
    };
  }, [isRunning]);

  return (
    <span className={`enodios-tool-helix ${isRunning ? "" : "stopped"}`}>
      {HELIX_FRAMES[frame]}
    </span>
  );
}

export const ChatMessageItem = memo(
  ({
    message,
    onEdit,
    view,
    isEditing,
    onStartEdit,
    onCancelEdit,
  }: ChatMessageItemProps): ReactElement => {
    const [isEditingLocal, setIsEditingLocal] = useState(false);
    const [editValue, setEditValue] = useState(message.content);
    const [isCopied, setIsCopied] = useState(false);

    const activeEditing = isEditing ?? isEditingLocal;
    const setEditing = (val: boolean) => {
      if (val) {
        if (onStartEdit) onStartEdit();
        else setIsEditingLocal(true);
      } else {
        if (onCancelEdit) onCancelEdit();
        else setIsEditingLocal(false);
      }
    };

    const handleCopy = useCallback(() => {
      navigator.clipboard
        .writeText(message.content)
        .then(() => {
          setIsCopied(true);
          window.setTimeout(() => {
            setIsCopied(false);
          }, 2000);
        })
        .catch(() => {
          new Notice("Failed to copy to clipboard");
        });
    }, [message.content]);

    let roleLabel: React.ReactNode = {
      assistant: "Hermes",
      reasoning: "Reasoning",
      system: "System",
      terminal: "Terminal Output",
      tool: "Tool",
      user: "You",
    }[message.role];

    if (message.role === "tool") {
      const isError = message.toolStatus === "error";
      const isRunning =
        message.isRunning === true || message.toolStatus === "running";
      const statusIcon = isError ? (
        "❌ "
      ) : (
        <HelixSpinner isRunning={isRunning} />
      );
      roleLabel = (
        <>
          {statusIcon}Tool: {message.toolName}
        </>
      );
    }

    // Collapsible reasoning and tool messages
    if (message.role === "tool" && message.isBackgrounded) {
      const isError = message.toolStatus === "error";
      const isRunning =
        message.isRunning === true || message.toolStatus === "running";
      const statusIcon = isError ? "❌" : isRunning ? "⚙️" : "✅";
      const statusText = isError
        ? "errored"
        : isRunning
          ? "running..."
          : "completed";
      return (
        <div className="enodios-message enodios-tool enodios-tool-backgrounded">
          <span className="enodios-backgrounded-tool-indicator">
            {statusIcon} {message.toolName} {statusText}
          </span>
        </div>
      );
    }

    if (message.role === "reasoning" || message.role === "tool") {
      const [isExpanded, setIsExpanded] = useState(!message.isCollapsed);
      const toggleExpand = useCallback(() => {
        setIsExpanded((prev) => !prev);
      }, []);

      return (
        <div
          className={`enodios-message enodios-${message.role} ${isExpanded ? `enodios-${message.role}-expanded` : `enodios-${message.role}-collapsed`}`}
        >
          <div className="enodios-message-header">
            <span className="enodios-role">{roleLabel}</span>
            <span className="enodios-message-meta">
              <button
                className="enodios-icon-btn enodios-msg-action-btn"
                draggable
                onClick={handleCopy}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", message.content);
                }}
                title={isCopied ? "Copied!" : "Copy or Drag Reasoning"}
                type="button"
              >
                {isCopied ? (
                  <svg
                    fill="none"
                    height="12"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="12"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg
                    fill="none"
                    height="12"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="12"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
              <button
                className="enodios-icon-btn enodios-msg-action-btn"
                onClick={toggleExpand}
                title={isExpanded ? "Collapse reasoning" : "Expand reasoning"}
                type="button"
              >
                {isExpanded ? (
                  <svg
                    fill="none"
                    height="12"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="12"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                ) : (
                  <svg
                    fill="none"
                    height="12"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="12"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                )}
              </button>
              <span className="enodios-timestamp">
                {new Date(message.timestamp).toLocaleTimeString()}
              </span>
            </span>
          </div>
          {isExpanded && (
            <div className="enodios-message-content">
              <MarkdownContent content={message.content} view={view} />
            </div>
          )}
        </div>
      );
    }

    if (message.role === "terminal") {
      return (
        <div className={`enodios-message enodios-${message.role}`}>
          <div className="enodios-message-header">
            <span className="enodios-role">{roleLabel}</span>
            <span className="enodios-message-meta">
              <button
                className="enodios-icon-btn enodios-msg-action-btn"
                draggable
                onClick={handleCopy}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", message.content);
                }}
                title={isCopied ? "Copied!" : "Copy or Drag Output"}
                type="button"
              >
                {isCopied ? (
                  <svg
                    fill="none"
                    height="12"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="12"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg
                    fill="none"
                    height="12"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="12"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                )}
              </button>
              <span className="enodios-timestamp">
                {new Date(message.timestamp).toLocaleTimeString()}
              </span>
            </span>
          </div>
          <div className="enodios-terminal-content">{message.content}</div>
          {!message.isExited && (
            <button
              className="enodios-abort-btn"
              onClick={() => {
                if (message.terminalId) {
                  view.abortTerminal(message.terminalId);
                }
              }}
              title="Stop the running command"
              type="button"
            >
              🛑 Abort
            </button>
          )}
        </div>
      );
    }

    if (activeEditing) {
      return (
        <div className={`enodios-message enodios-${message.role}`}>
          <div className="enodios-message-header">
            <span className="enodios-role">{roleLabel}</span>
          </div>
          <div className="enodios-message-content">
            <textarea
              autoFocus={true}
              className="enodios-edit-input"
              onChange={(e) => {
                setEditValue(e.target.value);
              }}
              rows={Math.max(3, editValue.split("\n").length)}
              value={editValue}
            />
            <div className="enodios-edit-actions">
              <button
                className="enodios-btn-approve"
                onClick={() => {
                  setEditing(false);
                  onEdit?.(message.id, editValue);
                }}
                type="button"
              >
                Save & Submit
              </button>
              <button
                className="enodios-btn-reject"
                onClick={() => {
                  setEditing(false);
                  setEditValue(message.content);
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`enodios-message enodios-${message.role} ${message.isRunning ? "enodios-tool-running" : ""}`}
      >
        <div className="enodios-message-header">
          <span className="enodios-role">{roleLabel}</span>
          <span className="enodios-message-meta">
            <button
              className="enodios-icon-btn enodios-msg-action-btn"
              draggable
              onClick={handleCopy}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", message.content);
              }}
              title={isCopied ? "Copied!" : "Copy or Drag Message"}
              type="button"
            >
              {isCopied ? (
                <svg
                  fill="none"
                  height="12"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="12"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  fill="none"
                  height="12"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="12"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
            {message.role === "user" && (
              <button
                className="enodios-icon-btn enodios-msg-action-btn"
                onClick={() => {
                  setEditing(true);
                }}
                title="Edit Message"
                type="button"
              >
                <svg
                  fill="none"
                  height="12"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="12"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </button>
            )}
            <span className="enodios-timestamp">
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
          </span>
        </div>
        <div className="enodios-message-content">
          <MarkdownContent content={message.content} view={view} />
        </div>
      </div>
    );
  },
);

interface MarkdownContentProps {
  content: string;
  view: EnodiosChatView;
}

export const MarkdownContent = memo(
  ({ content, view }: MarkdownContentProps): ReactElement => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const handlePathClick = (e: MouseEvent) => {
        const target = e.target as HTMLElement;

        // Handle native Obsidian links
        const internalLink = target.closest("a.internal-link");
        if (internalLink) {
          const href = internalLink.getAttribute("data-href");
          if (href) {
            const file = view.app.metadataCache.getFirstLinkpathDest(href, "");
            if (file instanceof TFile) {
              e.preventDefault();
              e.stopPropagation();
              void view.app.workspace
                .getLeaf(e.ctrlKey || e.metaKey ? "tab" : false)
                .openFile(file);
              return;
            }
          }
        }

        // Handle our custom clickable paths in inline code
        const code = target.closest("code.enodios-clickable-path");
        if (code) {
          const text = code.textContent;
          if (text) {
            const file =
              view.app.metadataCache.getFirstLinkpathDest(text, "") ??
              view.app.vault.getAbstractFileByPath(text);
            if (file instanceof TFile) {
              e.preventDefault();
              e.stopPropagation();
              void view.app.workspace
                .getLeaf(e.ctrlKey || e.metaKey ? "tab" : false)
                .openFile(file);
            }
          }
        }
      };

      container.addEventListener("click", handlePathClick);
      return () => {
        container.removeEventListener("click", handlePathClick);
      };
    }, [view]);

    useEffect(() => {
      if (!containerRef.current) {
        return;
      }

      containerRef.current.innerHTML = "";

      const renderChild = new Component();
      renderChild.load();

      let processedContent = content;

      // Fix fenced code blocks incorrectly placed inside table cells.
      // LLMs often output: | ```lang\ncode\n``` |
      // This breaks standard Markdown table parsing which expects single-line rows.
      processedContent = processedContent.replace(
        /(\|[^|\n]*?)```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)\n\s*```([^|\n]*)/g,
        (_substring: string, ...args: (string | number)[]) => {
          const before = args[0] as string;
          const lang = args[1] as string;
          const code = args[2] as string;
          const after = args[3] as string;
          const fixedCode = code
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>")
            .replace(/\|/g, "&#124;");
          const langClass = lang ? ` class="language-${lang}"` : "";
          return `${before}<pre><code${langClass}>${fixedCode}</code></pre>${after}`;
        },
      );

      try {
        MarkdownRenderer.render(
          view.app,
          processedContent,
          containerRef.current,
          view.app.vault.getRoot().path,
          renderChild,
        )
          .then(() => {
            if (!containerRef.current) {
              return;
            }
            const preElements = containerRef.current.querySelectorAll("pre");
            preElements.forEach((pre) => {
              if (
                pre.parentElement?.classList.contains(
                  "enodios-code-block-wrapper",
                )
              ) {
                return;
              }

              const wrapper = document.createElement("div");
              wrapper.className = "enodios-code-block-wrapper";
              pre.parentNode?.insertBefore(wrapper, pre);
              wrapper.appendChild(pre);

              const copyBtn = document.createElement("button");
              copyBtn.className = "enodios-icon-btn enodios-code-copy-btn";
              copyBtn.title = "Copy or Drag code";
              copyBtn.draggable = true;
              copyBtn.addEventListener("dragstart", (e: DragEvent) => {
                const codeEl = pre.querySelector("code");
                if (codeEl && e.dataTransfer) {
                  e.dataTransfer.setData("text/plain", codeEl.innerText);
                }
              });
              copyBtn.innerHTML =
                '<svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg"><rect height="13" rx="2" ry="2" width="13" x="9" y="9" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>';

              copyBtn.addEventListener("click", () => {
                const codeEl = pre.querySelector("code");
                if (codeEl) {
                  void navigator.clipboard
                    .writeText(codeEl.innerText)
                    .then(() => {
                      copyBtn.innerHTML =
                        '<svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg"><polyline points="20 6 9 17 4 12" /></svg>';
                      copyBtn.classList.add("copied");
                      window.setTimeout(() => {
                        copyBtn.innerHTML =
                          '<svg fill="none" height="12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg"><rect height="13" rx="2" ry="2" width="13" x="9" y="9" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>';
                        copyBtn.classList.remove("copied");
                      }, 2000);
                    })
                    .catch(() => {
                      // Ignore copy errors
                    });
                }
              });
              wrapper.appendChild(copyBtn);
            });

            // Highlight clickable file paths in inline code blocks
            const inlineCodeElements =
              containerRef.current.querySelectorAll("code");
            inlineCodeElements.forEach((code) => {
              if (code.closest("pre")) {
                return;
              }
              const text = code.textContent;
              if (text) {
                const file =
                  view.app.metadataCache.getFirstLinkpathDest(text, "") ??
                  view.app.vault.getAbstractFileByPath(text);
                if (file instanceof TFile) {
                  code.classList.add("enodios-clickable-path");
                  code.title = `Click to open ${file.path}\nDrag to insert link`;
                  code.draggable = true;
                  code.addEventListener("dragstart", (e: DragEvent) => {
                    // Access internal Obsidian dragManager API.
                    // `dragFile` is not in the public typings, so cast through unknown.
                    const dragManager = (
                      view.app as unknown as {
                        dragManager?: {
                          dragFile: (event: DragEvent, file: TFile) => void;
                        };
                      }
                    ).dragManager;
                    if (dragManager) {
                      dragManager.dragFile(e, file);
                    } else if (e.dataTransfer) {
                      e.dataTransfer.setData("text/plain", `[[${file.path}]]`);
                    }
                  });
                }
              }
            });
          })
          .catch(() => {
            // Ignore render errors
          });
      } catch {
        containerRef.current.textContent = content;
      }

      return () => {
        renderChild.unload();
      };
    }, [content, view]);

    return <div className="enodios-markdown-renderer" ref={containerRef} />;
  },
);
