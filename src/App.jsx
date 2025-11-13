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

/** ----------------------------------------------------
 * Parse JSONL
 * ---------------------------------------------------- */
function parseJsonl(raw) {
  if (!raw) return [];
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** ----------------------------------------------------
 * Normalize BDI to array of {type, text}
 * ---------------------------------------------------- */
function normalizeBDI(bdi) {
  if (!bdi) return [];
  if (Array.isArray(bdi)) return bdi;
  if (typeof bdi === "object")
    return Object.entries(bdi).map(([type, text]) => ({ type, text }));
  return [];
}

/** ----------------------------------------------------
 * Parse target_bdi_id like "A2_belief"
 * Returns { role: "Assistant", turn: 2, bdi: "belief" }
 * ---------------------------------------------------- */
function parseTargetBdiId(id) {
  if (!id || typeof id !== "string") return null;
  const match = id.match(/^([AH])(\d+)_(belief|desire|intention)$/i);
  if (!match) return null;

  return {
    role: match[1] === "A" ? "Assistant" : "Human",
    turn: Number(match[2]),
    bdi: match[3],
  };
}

/** ----------------------------------------------------
 * Get actual targeted BDI text from the conversation
 * ---------------------------------------------------- */
function getTargetBdiText(conversation, parsed) {
  if (!parsed) return null;

  const targetTurn = conversation.turns.find(
    (t) => t.turn_id === parsed.turn && t.role === parsed.role
  );
  if (!targetTurn) return null;

  const normalized = normalizeBDI(targetTurn.bdi);
  const bdiItem = normalized.find((b) => b.type === parsed.bdi);
  return bdiItem ? bdiItem.text : null;
}

/** ----------------------------------------------------
 * MAIN APP
 * ---------------------------------------------------- */
export default function App() {
  const conversations = useMemo(() => parseJsonl(rawData), [rawData]);
  const total = conversations.length || 0;

  const [idx, setIdx] = useState(0);
  const [localRatings, setLocalRatings] = useState({});
  const [annotations, setAnnotations] = useState([]);

  /** Load saved */
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

  /** Persist saved */
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(annotations));
  }, [annotations]);

  /** Clear draft when switching convo */
  useEffect(() => setLocalRatings({}), [idx]);

  if (total === 0) {
    return (
      <div className="card">
        <h2>No conversations found in data file.</h2>
      </div>
    );
  }

  const conv = conversations[idx];

  /** Key helpers */
  function makeKey(...parts) {
    return parts.join("|||");
  }

  const setRating = (key, r) =>
    setLocalRatings((prev) => ({ ...prev, [key]: r }));
  const getRating = (key) => localRatings[key] ?? null;

  /** Build annotation JSON */
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

      const normalizedBDI = normalizeBDI(turn.bdi);

      // BDI ratings
      for (const bdiItem of normalizedBDI) {
        const key = makeKey(turn.turn_id, "bdi", bdiItem.text);
        const chosen = getRating(key) ?? "Neutral";
        turnObj.bdi_ratings[bdiItem.text] = {
          rating: chosen,
          type: bdiItem.type,
        };
      }

      // Attack mapping ratings
      if (turn.role === "Human" && (turn.attack_mappings?.length || 0) > 0) {
        for (const [i, atk] of turn.attack_mappings.entries()) {
          const keyBase = makeKey(turn.turn_id, "attack", i);

          const targetTypeRating =
            getRating(makeKey(keyBase, "target_type")) ?? "Neutral";
          const strategyRating =
            getRating(makeKey(keyBase, "strategy")) ?? "Neutral";

          turnObj.attack_mapping_ratings.push({
            target_bdi_id: atk.target_bdi_id,
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
      alert("No annotations yet.");
      return;
    }
    const blob = new Blob(
      [annotations.map((a) => JSON.stringify(a)).join("\n")],
      { type: "text/plain;charset=utf-8" }
    );
    saveAs(blob, "annotations.jsonl");
  }

  function clearLocalAnnotations() {
    if (window.confirm("Clear all saved annotations?")) {
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

  /** ----------------------------------------------------
   * RENDER
   * ---------------------------------------------------- */
  return (
    <div className="app-container">
      <h1>🎯 BDI & Attack Mapping Annotation Tool</h1>

      {/* Header */}
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

      {/* Stratum Rating */}
      <div className="card">
        <div className="bdi-label underlined">Stratum Rating</div>
        <div className="bdi-text">
          Is the assigned stratum <strong>{conv.stratum}</strong> correct?
        </div>

        <RatingGroup
          options={RATING_OPTIONS}
          selected={getRating(makeKey("stratum"))}
          onSelect={(opt) => setRating(makeKey("stratum"), opt)}
        />
      </div>

      {/* Turns */}
      {conv.turns.map((turn) => {
        const normalizedBDI = normalizeBDI(turn.bdi);

        return (
          <div
            key={turn.turn_id}
            className={`card ${
              turn.role.toLowerCase() === "human"
                ? "human-card"
                : "assistant-card"
            }`}
          >
            <div className="turn-header">
              <strong>
                {turn.role === "Human" ? "👤 Human" : "🤖 Assistant"} (Turn{" "}
                {turn.turn_id})
              </strong>
            </div>

            <div className="turn-text">{turn.text}</div>

            {/* BDI Ratings */}
            {["belief", "desire", "intention"].map((tp) => {
              const items = normalizedBDI.filter((b) => b.type === tp);
              if (!items.length) return null;

              const label =
                tp.charAt(0).toUpperCase() + tp.slice(1) + "s";

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

            {/* Attack mappings */}
            {turn.role === "Human" &&
              (turn.attack_mappings?.length || 0) > 0 && (
                <div className="attack-group spaced">
                  <div className="bdi-label underlined">
                    Attack Mapping Ratings
                  </div>

                  {turn.attack_mappings.map((atk, i) => {
                    const keyBase = makeKey(turn.turn_id, "attack", i);

                    // parse target_bdi_id
                    const parsed = parseTargetBdiId(atk.target_bdi_id);
                    const actualBDIText = getTargetBdiText(conv, parsed);

                    return (
                      <div key={i} className="attack-item spaced-item">
                        <div className="bdi-text">
                          <strong>Target BDI:</strong>{" "}
                          {parsed ? (
                            <code>
                              {parsed.role} Turn {parsed.turn} —{" "}
                              {parsed.bdi}
                            </code>
                          ) : (
                            <code>{atk.target_bdi_id}</code>
                          )}
                          <br />

                          {actualBDIText && (
                            <div className="target-bdi-text">
                              <em>“{actualBDIText}”</em>
                            </div>
                          )}

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
                              selected={getRating(
                                makeKey(keyBase, "target_type")
                              )}
                              onSelect={(opt) =>
                                setRating(
                                  makeKey(keyBase, "target_type"),
                                  opt
                                )
                              }
                            />
                          </div>

                          <div>
                            <div className="mini-label">
                              Attack Strategy correctness
                            </div>
                            <RatingGroup
                              options={RATING_OPTIONS}
                              selected={getRating(
                                makeKey(keyBase, "strategy")
                              )}
                              onSelect={(opt) =>
                                setRating(
                                  makeKey(keyBase, "strategy"),
                                  opt
                                )
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
        );
      })}

      {/* Submit */}
      <div className="submit-section">
        <button
          className="primary"
          onClick={() => handleSubmitConversation(true)}
        >
          💾 Submit & Next
        </button>

        <button onClick={() => handleSubmitConversation(false)}>
          💾 Submit (Stay)
        </button>

        <div className="submit-note">
          Annotations auto-save locally.
        </div>
      </div>

      <hr />

      {/* Download & Clear */}
      <div className="bottom-bar">
        <button onClick={downloadJsonl}>
          📥 Download annotations.jsonl
        </button>
        <button
          className="danger"
          onClick={clearLocalAnnotations}
        >
          🗑️ Clear Saved
        </button>
        <div className="annotation-count">
          Saved annotations: <strong>{annotations.length}</strong>
        </div>
      </div>

      <hr />

      {/* Preview latest */}
      <div className="preview-section">
        <div className="preview-label">Latest submission:</div>
        {annotations.length === 0 ? (
          <div className="no-submission">None yet</div>
        ) : (
          <pre>
            {JSON.stringify(
              annotations[annotations.length - 1],
              null,
              2
            )}
          </pre>
        )}
      </div>
    </div>
  );
}
