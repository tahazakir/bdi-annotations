import React, { useEffect, useMemo, useState } from "react";
import { saveAs } from "file-saver";
import rawData from "./data/review_100_conversations_with_mappings.jsonl?raw";
import "./App.css";

const RATING_OPTIONS = [
  "Strongly Disagree",
  "Disagree",
  "Neutral",
  "Agree",
  "Strongly Agree",
];

const STORAGE_KEY = "bdi_annotations_v2";

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

  function makeKey(...parts) {
    return parts.join("|||");
  }

  function setRating(key, rating) {
    setLocalRatings((prev) => ({ ...prev, [key]: rating }));
  }

  function getRating(key) {
    return localRatings[key] ?? null;
  }

  /** Build structured JSON for current conversation */
  function buildAnnotationObjectForCurrentConv() {
    const annotation = {
      conversation_id: conv.conversation_id,
      stratum: conv.stratum ?? "Unknown",
      stratum_rating: getRating(makeKey("stratum")),
      turn_annotations: [],
    };

    for (const turn of conv.turns) {
      const turnObj = {
        turn_id: turn.turn_id,
        role: turn.role,
        bdi_ratings: {},
        attack_mapping_ratings: [],
      };

      // BDI ratings
      for (const bdiItem of turn.bdi ?? []) {
        const key = makeKey(turn.turn_id, "bdi", bdiItem.text);
        const chosen = getRating(key) ?? "Neutral";
        turnObj.bdi_ratings[bdiItem.text] = {
          rating: chosen,
          type: bdiItem.type,
        };
      }

      // Attack mapping ratings (only for human turns, not first)
      if (turn.role === "Human" && (turn.attack_mappings?.length || 0) > 0) {
        for (const [i, atk] of turn.attack_mappings.entries()) {
          const keyBase = makeKey(turn.turn_id, "attack", i);
          const targetTypeRating =
            getRating(makeKey(keyBase, "target_type")) ?? "Neutral";
          const strategyRating =
            getRating(makeKey(keyBase, "strategy")) ?? "Neutral";
          turnObj.attack_mapping_ratings.push({
            target_bdi_type: atk.target_bdi_type,
            attack_strategy: atk.attack_strategy,
            target_type_rating: targetTypeRating,
            strategy_rating: strategyRating,
            explanation: atk.explanation,
          });
        }
      }

      annotation.turn_annotations.push(turnObj);
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

  /** Rating button group */
  function RatingGroup({ options, selected, onSelect }) {
    return (
      <div className="rating-group">
        {options.map((opt) => (
          <button
            key={opt}
            className={`rating-btn ${selected === opt ? "selected" : ""}`}
            onClick={() => onSelect(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="app-container">
      <h1>🎯 BDI & Attack Mapping Annotation Tool</h1>

      {/* Top bar */}
      <div className="top-bar">
        <div>
          <div className="conv-meta">
            <strong>
              Conversation {idx + 1}/{total}
            </strong>
            <span className="stratum"> {conv.stratum ?? "Unknown"}</span>
          </div>
          <div className="conv-id">
            ID: <code>{conv.conversation_id}</code>
          </div>
        </div>

        <div className="nav-buttons">
          <button onClick={() => setIdx((i) => Math.max(0, i - 1))}>
            ⬅️ Prev
          </button>
          <button onClick={() => setIdx((i) => Math.min(total - 1, i + 1))}>
            Next ➡️
          </button>
        </div>
      </div>

      <hr />

      {/* Stratum rating */}
      <div className="card">
        <div className="bdi-label underlined">Stratum Rating</div>
        <div className="bdi-text">
          Is the assigned stratum <strong>{conv.stratum}</strong> correct for
          this conversation?
        </div>
        <RatingGroup
          options={RATING_OPTIONS}
          selected={getRating(makeKey("stratum"))}
          onSelect={(opt) => setRating(makeKey("stratum"), opt)}
        />
      </div>

      {/* Turns */}
      {conv.turns.map((turn) => (
        <div
          key={turn.turn_id}
          className={`card ${
            turn.role.toLowerCase() === "human" ? "human-card" : "assistant-card"
          }`}
        >
          <div className="turn-header">
            <strong>
              {turn.role.toLowerCase() === "human"
                ? "👤 Human"
                : "🤖 Assistant"}{" "}
              (Turn {turn.turn_id})
            </strong>
          </div>

          <div className="turn-text">{turn.text}</div>

          {/* BDI ratings */}
          {["belief", "desire", "intention"].map((tp) => {
            const items = (turn.bdi ?? []).filter((b) => b.type === tp);
            if (items.length === 0) return null;
            const label = tp.charAt(0).toUpperCase() + tp.slice(1) + "s";
            return (
              <div key={tp} className="bdi-group spaced">
                <div className="bdi-label underlined">{label}</div>
                {items.map((item) => {
                  const key = makeKey(turn.turn_id, "bdi", item.text);
                  return (
                    <div key={item.text} className="spaced-item">
                      <div className="bdi-text">{item.text}</div>
                      <RatingGroup
                        options={RATING_OPTIONS}
                        selected={getRating(key)}
                        onSelect={(opt) => setRating(key, opt)}
                      />
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Attack mappings (for human turns, skip first) */}
          {turn.role === "Human" &&
            (turn.attack_mappings?.length || 0) > 0 && (
              <div className="attack-group spaced">
                <div className="bdi-label underlined">
                  Attack Mapping Ratings
                </div>
                {turn.attack_mappings.map((atk, i) => {
                  const keyBase = makeKey(turn.turn_id, "attack", i);
                  return (
                    <div key={i} className="attack-item spaced-item">
                      <div className="bdi-text">
                        <strong>Target BDI Type:</strong>{" "}
                        <code>{atk.target_bdi_type}</code> <br />
                        <strong>Attack Strategy:</strong>{" "}
                        <code>{atk.attack_strategy}</code>
                        <br />
                        <em>{atk.explanation}</em>
                      </div>

                      <div className="attack-rating-pair">
                        <div>
                          <div className="mini-label">
                            Target BDI Type correctness
                          </div>
                          <RatingGroup
                            options={RATING_OPTIONS}
                            selected={getRating(makeKey(keyBase, "target_type"))}
                            onSelect={(opt) =>
                              setRating(makeKey(keyBase, "target_type"), opt)
                            }
                          />
                        </div>
                        <div>
                          <div className="mini-label">
                            Attack Strategy correctness
                          </div>
                          <RatingGroup
                            options={RATING_OPTIONS}
                            selected={getRating(makeKey(keyBase, "strategy"))}
                            onSelect={(opt) =>
                              setRating(makeKey(keyBase, "strategy"), opt)
                            }
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      ))}

      {/* Submit */}
      <div className="submit-section">
        <button className="primary" onClick={() => handleSubmitConversation(true)}>
          💾 Submit & Next
        </button>
        <button onClick={() => handleSubmitConversation(false)}>
          💾 Submit (Stay)
        </button>
        <div className="submit-note">
          Annotations auto-save locally. Ratings reset when switching
          conversations.
        </div>
      </div>

      <hr />

      {/* Download & Clear */}
      <div className="bottom-bar">
        <button onClick={downloadJsonl}>📥 Download annotations.jsonl</button>
        <button className="danger" onClick={clearLocalAnnotations}>
          🗑️ Clear Saved
        </button>
        <div className="annotation-count">
          Saved annotations: <strong>{annotations.length}</strong>
        </div>
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
