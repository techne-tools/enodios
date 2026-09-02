import { Modal, TFile, Notice } from "obsidian";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { useState, useEffect } from "react";
import type { Plugin } from "../Plugin.ts";

interface TagSuggestionComponentProps {
  plugin: Plugin;
  file: TFile;
  close: () => void;
}

function TagSuggestionComponent({
  plugin,
  file,
  close,
}: TagSuggestionComponentProps) {
  const [suggestions, setSuggestions] = useState<
    { tag: string; confidence: number }[]
  >([]);
  const [selectedTags, setSelectedTags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        const content = await plugin.app.vault.read(file);
        const title = file.basename;
        const results = plugin.tagManager.suggestTagsForContent(content, title);

        setSuggestions(results);

        // Auto-select tags with >= 60% confidence
        const initialSelected: Record<string, boolean> = {};
        results.forEach((r) => {
          if (r.confidence >= 0.6) {
            initialSelected[r.tag] = true;
          }
        });
        setSelectedTags(initialSelected);
      } catch {
        new Notice("Failed to generate tag suggestions");
      } finally {
        setLoading(false);
      }
    };

    void fetchSuggestions();
  }, [plugin, file]);

  const handleToggleSelect = (tag: string) => {
    setSelectedTags((prev) => ({
      ...prev,
      [tag]: !prev[tag],
    }));
  };

  const handleSelectAll = () => {
    const updated: Record<string, boolean> = {};
    suggestions.forEach((s) => {
      updated[s.tag] = true;
    });
    setSelectedTags(updated);
  };

  const handleSelectNone = () => {
    setSelectedTags({});
  };

  const handleApply = async () => {
    const tagsToApply = Object.keys(selectedTags).filter(
      (t) => selectedTags[t],
    );
    if (tagsToApply.length === 0) {
      new Notice("No tags selected to apply.");
      return;
    }

    try {
      await plugin.tagManager.applyTagsToNote(file, tagsToApply);
      new Notice(
        `Successfully applied ${String(tagsToApply.length)} tag(s) to ${file.basename}`,
      );
      close();
    } catch {
      new Notice("Failed to apply tags to note.");
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <div
          className="enodios-tool-spinner"
          style={{ margin: "0 auto 10px auto" }}
        >
        </div>
        <div>Analyzing note content...</div>
      </div>
    );
  }

  if (suggestions.length === 0) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <p>No matching tags from your vault were found in this note.</p>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "20px",
          }}
        >
          <button className="btn" onClick={close}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const selectedCount = Object.values(selectedTags).filter(Boolean).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: "0.9em", color: "var(--text-muted)" }}>
          Suggested based on keywords found in the note
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="btn btn-xs" onClick={handleSelectAll}>
            Select All
          </button>
          <button className="btn btn-xs" onClick={handleSelectNone}>
            Clear All
          </button>
        </div>
      </div>

      <div
        style={{
          maxHeight: "300px",
          overflowY: "auto",
          border: "1px solid var(--border-color)",
          borderRadius: "4px",
          padding: "5px",
        }}
      >
        {suggestions.map((s) => {
          const isSelected = !!selectedTags[s.tag];
          const pct = Math.round(s.confidence * 100);

          return (
            <div
              key={s.tag}
              onClick={() => {
                handleToggleSelect(s.tag);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                cursor: "pointer",
                borderRadius: "4px",
                backgroundColor: isSelected
                  ? "var(--background-modifier-hover)"
                  : "transparent",
                marginBottom: "4px",
                transition: "background-color 0.1s ease",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "10px" }}
              >
                <input
                  checked={isSelected}
                  onChange={() => {
                    // handled by row click
                  }}
                  style={{ cursor: "pointer" }}
                  type="checkbox"
                />
                <span
                  style={{ fontWeight: "600", color: "var(--text-normal)" }}
                >
                  {s.tag}
                </span>
              </div>
              <span
                style={{
                  fontSize: "0.85em",
                  padding: "2px 6px",
                  borderRadius: "12px",
                  backgroundColor:
                    pct >= 80
                      ? "var(--text-success)"
                      : pct >= 60
                        ? "var(--text-accent)"
                        : "var(--background-modifier-border)",
                  color: pct >= 60 ? "#ffffff" : "var(--text-normal)",
                  fontWeight: "600",
                }}
              >
                {pct}%
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "10px",
        }}
      >
        <span style={{ fontSize: "0.9em", color: "var(--text-muted)" }}>
          {selectedCount} selected of {suggestions.length}
        </span>
        <div style={{ display: "flex", gap: "10px" }}>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              void handleApply();
            }}
          >
            Apply Selected Tags
          </button>
        </div>
      </div>
    </div>
  );
}

export class TagSuggestionModal extends Modal {
  private readonly plugin: Plugin;
  private root: Root | null = null;

  constructor(plugin: Plugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  public override onOpen() {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      this.contentEl.setText("No active note to suggest tags for.");
      return;
    }

    this.titleEl.setText("Suggest Tags for Note");

    this.root = createRoot(this.contentEl);
    this.root.render(
      <TagSuggestionComponent
        close={() => {
          this.close();
        }}
        file={activeFile}
        plugin={this.plugin}
      />,
    );
  }

  public override onClose() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
  }
}
