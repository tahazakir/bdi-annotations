import React, { useEffect, useMemo, useState } from "react";
import { saveAs } from "file-saver";
import rawData from "./data/100_sampled_bdi_review.jsonl?raw";
import "./App.css";

const RATING_OPTIONS = [
  "Strongly Disagree",
  "Disagree",
  "Neutral",
  "Agree",
  "Strongly Agree",
];

const STORAGE_KEY = "bdi_annotations_v1";

function parseJsonl(raw) {
  if (!raw) return [];
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export default function App() {
  const conversations = useMemo(() => parseJsonl(rawData), [rawData]);
  const total = conversations.length || 0;

  const [idx, setIdx] = useState(0);
  const [localRatings, setLocalRatings] = useState({});
  const [annotations, setAnnotations] = useState([]);

  // load saved annotations
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setAnnotations(Array.isArray(parsed) ? parsed : []);
      } catch (err) {
        console.warn("Failed to parse saved annotations:", err);
      }
    }
  }, []);

  // persist whenever annotations change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations));
  }, [annotations]);

  // clear draft when switching conversation
  useEffect(() => setLocalRatings({}), [idx]);

  if (total === 0) {
    return (
      <div className="card">
        <h2>No conversations found in the data file.</h2>
        <p>Ensure your JSONL file is imported via ?raw correctly.</p>
      </div>
    );
  }

  const conv = conversations[idx];

  function setRating(turnId, itemText, rating) {
    const key = `${turnId}|||${itemText}`;
    setLocalRatings((prev) => ({ ...prev, [key]: rating }));
  }

  // Build annotation object with optimized structure:
  // turn_annotations[].bdi_ratings = { "<text>": { rating: "...", type: "belief" } }
  function buildAnnotationObjectForCurrentConv() {
    const annotation = {
      conversation_id: conv.conversation_id,
      stratum: conv.stratum ?? "Unknown",
      turn_annotations: [],
    };

    for (const turn of conv.turns) {
      const t = {
        turn_id: turn.turn_id,
        role: turn.role,
        bdi_ratings: {},
      };

      for (const item of turn.bdi ?? []) {
        const key = `${turn.turn_id}|||${item.text}`;
        const chosen = localRatings[key] ?? "Neutral";
        // NOTE: we do NOT include `text` inside the object because the key IS the text
        t.bdi_ratings[item.text] = {
          rating: chosen,
          type: item.type,
        };
      }

      annotation.turn_annotations.push(t);
    }

    return annotation;
  }

  function handleSubmitConversation(advance = true) {
    const annotation = buildAnnotationObjectForCurrentConv();
    setAnnotations((prev) => [...prev, annotation]);
    setLocalRatings({});
    if (advance) setIdx((i) => Math.min(i + 1, total - 1));
  }

  function downloadJsonl() {
    if (annotations.length === 0) {
      alert("No annotations yet. Submit at least one conversation first.");
      return;
    }
    const lines = annotations.map((a) => JSON.stringify(a)).join("\n");
    const blob = new Blob([lines], { type: "text/plain;charset=utf-8" });
    saveAs(blob, "annotations.jsonl");
  }

  function clearLocalAnnotations() {
    if (window.confirm("Clear all saved annotations? This cannot be undone.")) {
      localStorage.removeItem(STORAGE_KEY);
      setAnnotations([]);
    }
  }

  function getSelectedRating(turnId, itemText) {
    const key = `${turnId}|||${itemText}`;
    return localRatings[key] ?? null;
  }

  return (
    <div className="app-container">
      <h1>🎯 BDI Annotation Tool</h1>

      {/* Top bar: index, stratum, conversation id */}
      <div className="top-bar">
        <div>
          <div className="conv-meta">
            <strong>
              Conversation {idx + 1}/{total}
            </strong>
            <span className="stratum"> {conv.stratum ?? "Unknown"}</span>
          </div>
          <div className="conv-id">ID: <code>{conv.conversation_id}</code></div>
        </div>

        <div className="nav-buttons">
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))}>⬅️ Prev</button>
          <button onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}>Next ➡️</button>
        </div>
      </div>

      <hr />

      {/* Turns */}
      {conv.turns.map((turn) => (
        <div
          key={turn.turn_id}
          className={`card ${turn.role.toLowerCase() === "human" ? "human-card" : "assistant-card"}`}
        >
          <div className="turn-header">
            <strong>
              {turn.role.toLowerCase() === "human" ? "👤 Human" : "🤖 Assistant"} (Turn {turn.turn_id})
            </strong>
          </div>

          <div className="turn-text">{turn.text}</div>

          {/* BDI groups with spacing: label (underlined), item, buttons */}
          {["belief", "desire", "intention"].map((tp) => {
            const items = (turn.bdi ?? []).filter((b) => b.type === tp);
            if (items.length === 0) return null;

            // Capitalize label
            const label = tp.charAt(0).toUpperCase() + tp.slice(1) + "s";

            return (
              <div key={tp} className="bdi-group spaced">
                <div className="bdi-label underlined">{label}</div>

                {items.map((item) => (
                  <div key={item.text} className="bdi-item spaced-item">
                    <div className="bdi-text">{item.text}</div>
                    <div className="rating-group">
                      {RATING_OPTIONS.map((opt) => {
                        const selected = getSelectedRating(turn.turn_id, item.text) === opt;
                        return (
                          <button
                            key={opt}
                            className={`rating-btn ${selected ? "selected" : ""}`}
                            onClick={() => setRating(turn.turn_id, item.text, opt)}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}

      {/* Submit */}
      <div className="submit-section">
        <button className="primary" onClick={() => handleSubmitConversation(true)}>
          💾 Submit This Conversation & Next
        </button>

        <button onClick={() => handleSubmitConversation(false)}>
          💾 Submit This Conversation (stay)
        </button>

        <div className="submit-note">
          Submitted annotations are auto-saved locally. Draft selections reset when switching conversations.
        </div>
      </div>

      <hr />

      {/* Download + Clear */}
      <div className="bottom-bar">
        <button onClick={downloadJsonl}>📥 Download annotations.jsonl</button>
        <button className="danger" onClick={clearLocalAnnotations}>🗑️ Clear Saved Annotations</button>

        <div className="annotation-count">Saved annotations: <strong>{annotations.length}</strong></div>
      </div>

      <hr />

      {/* Preview latest */}
      <div className="preview-section">
        <div className="preview-label">Latest submission (preview):</div>
        {annotations.length === 0 ? (
          <div className="no-submission">No submissions yet</div>
        ) : (
          <pre>{JSON.stringify(annotations[annotations.length - 1], null, 2)}</pre>
        )}
      </div>
    </div>
  );
}
