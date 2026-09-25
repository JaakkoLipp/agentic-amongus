import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActiveTaskView, AnswerFormat, JsonValue, TaskAnswer, TaskKind, TaskOption, TaskView } from "@deduction/shared";

/**
 * Task UI rendered from the same `TaskView` + `AnswerFormat` an AI agent receives. Content is shown generically
 * (with a few layout helpers for grids, glyph rows and route graphs); answers use one control per answer format.
 * Milestone 3 adds bespoke per-kind visuals on top of this.
 */
export function TaskPanel(props: {
  task: ActiveTaskView;
  canSubmit: boolean;
  secondsLeft: number | null;
  onSubmit: (answer: TaskAnswer) => void;
  onCancel: () => void;
}) {
  const { task } = props;
  const view = task.view;
  const phases = ["Memorize", "Hold", "Answer"];
  // The first countdown value seen in a phase is its length (phases vary per task), for the timer bar.
  const span = useRef<{ key: string; seconds: number } | null>(null);
  const phaseKey = `${task.taskId}#${task.attempt}#${task.phaseIndex}`;
  if (props.secondsLeft !== null && span.current?.key !== phaseKey) span.current = { key: phaseKey, seconds: Math.max(0.1, props.secondsLeft) };
  const timed = props.secondsLeft !== null && span.current?.key === phaseKey;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.onCancel]);

  return (
    <div className="task-backdrop">
      <div className="task-panel" role="dialog" aria-label={view.title}>
        <header>
          <div>
            <h2>{view.title}</h2>
            <span className="muted">
              Attempt {task.attempt}
              {task.phaseCount > 1 && ` · step ${task.phaseIndex + 1} of ${task.phaseCount}`}
            </span>
          </div>
          {task.phaseCount > 1 && (
            <ol className="phase-steps">
              {(["observe", "delay", "answer"] as const).map((p, i) => (
                <li key={p} className={view.phase === p ? "current" : ""}>
                  {phases[i]}
                </li>
              ))}
            </ol>
          )}
          <button className="icon close" onClick={props.onCancel} title="Close (Esc)" aria-label="Close task">
            ✕
          </button>
        </header>
        {timed && (
          <div className="timer">
            <div className="timer-fill" style={{ width: `${Math.min(100, (props.secondsLeft! / span.current!.seconds) * 100)}%` }} />
          </div>
        )}
        <p className="prompt">{view.prompt}</p>
        <TaskContent view={view} />
        {view.phase === "delay" && <div className="hold">Keep it in mind…</div>}
        {view.answerFormat && (
          <AnswerInput key={`${task.taskId}#${task.attempt}`} view={view} format={view.answerFormat} disabled={!props.canSubmit} onSubmit={props.onSubmit} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Content

/** Keys that repeat information shown elsewhere (prompt, answer options) or only exist for machine readers. */
const HIDDEN: Partial<Record<TaskKind, readonly string[]>> = {
  sequence_recall: ["length"],
  working_memory: ["columns", "rows", "lit", "litCount"],
  pattern_match: ["size"],
  symbol_match: ["targetNames"],
  arithmetic: ["tokens"],
  classification: ["attributes"],
  anomaly_detection: ["rules", "lines"],
  temporal_reasoning: ["events"],
  spatial_reasoning: ["columns", "rows"],
  route_planning: ["nodes", "edges", "start", "goal"],
  short_logic: ["switches"],
  sorting: ["crates"],
  checksum: ["digits", "rule"],
};

const isGridRows = (v: JsonValue): v is string[] =>
  Array.isArray(v) && v.length > 0 && v.every((r) => typeof r === "string" && /^[#.]+$/.test(r)) && new Set(v.map((r) => (r as string).length)).size === 1;

type Obj = { readonly [k: string]: JsonValue };
const isObj = (v: JsonValue): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function TaskContent({ view }: { view: TaskView }) {
  const c = view.content as Obj;
  const hidden = new Set(HIDDEN[view.kind] ?? []);
  const parts: ReactNode[] = [];

  if (view.kind === "sequence_recall" && Array.isArray(c.digits)) {
    parts.push(
      <div key="digits" className="big-digits">
        {c.digits.map((d, i) => (
          <span key={i}>{String(d)}</span>
        ))}
      </div>,
    );
    hidden.add("digits");
  }
  if (view.kind === "working_memory" && isGridRows(c.grid ?? null)) {
    parts.push(<CellGrid key="grid" rows={c.grid as string[]} columns={c.columns as string[]} rowLabels={c.rows as number[]} big />);
    hidden.add("grid");
  }
  // The path answer draws its own clickable graph.
  if (view.kind === "route_planning" && Array.isArray(c.nodes) && Array.isArray(c.edges) && view.answerFormat?.type !== "path") {
    parts.push(<RouteGraph key="graph" content={c} path={[]} />);
  }
  if (Array.isArray(c.candidates) && c.target !== undefined) {
    parts.push(<Candidates key="cands" target={c.target} candidates={c.candidates} />);
    hidden.add("target").add("candidates");
  }

  for (const [k, v] of Object.entries(c)) {
    if (hidden.has(k)) continue;
    parts.push(<Field key={k} name={k} value={v} />);
  }
  if (parts.length === 0) return null;
  return <div className="task-content">{parts}</div>;
}

function Field({ name, value }: { name: string; value: JsonValue }) {
  const label = humanize(name);
  if (value === null) return null;
  if (typeof value !== "object") {
    return (
      <div className="field">
        <span className="field-name">{label}</span> <span className="field-value">{String(value)}</span>
      </div>
    );
  }
  if (isGridRows(value)) {
    return (
      <div className="field">
        <span className="field-name">{label}</span>
        <CellGrid rows={value} />
      </div>
    );
  }
  if (Array.isArray(value)) {
    const texts = value.map(itemText);
    const primitive = value.every((v) => typeof v !== "object");
    return (
      <div className="field">
        <span className="field-name">{label}</span>
        {primitive ? (
          <div className="chips">
            {texts.map((t, i) => (
              <span key={i} className="chip">
                {t}
              </span>
            ))}
          </div>
        ) : (
          <ol className="lines">
            {texts.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        )}
      </div>
    );
  }
  return (
    <div className="field">
      <span className="field-name">{label}</span> <span className="field-value">{itemText(value)}</span>
    </div>
  );
}

/** Objects that carry a readable `text` are shown as that text (prefixed by an id when useful). */
function itemText(v: JsonValue): string {
  if (v === null) return "";
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return v.map(itemText).join(" ");
  if (typeof v.text === "string") return typeof v.id === "string" && !v.text.startsWith(v.id) ? `${v.id}: ${v.text}` : v.text;
  if (typeof v.label === "string") return v.label;
  return Object.entries(v)
    .map(([k, x]) => `${humanize(k)}: ${itemText(x)}`)
    .join(", ");
}

function humanize(key: string): string {
  const s = key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
  return s[0]!.toUpperCase() + s.slice(1);
}

function CellGrid(props: { rows: readonly string[]; columns?: readonly string[]; rowLabels?: readonly number[]; big?: boolean }) {
  return (
    <div className={`cell-grid ${props.big ? "big" : ""}`}>
      {props.columns && (
        <div className="cg-row labels">
          <span className="cg-corner" />
          {props.columns.map((c) => (
            <span key={c} className="cg-label">
              {c}
            </span>
          ))}
        </div>
      )}
      {props.rows.map((row, y) => (
        <div key={y} className="cg-row">
          {props.rowLabels && <span className="cg-label">{props.rowLabels[y]}</span>}
          {[...row].map((ch, x) => (
            <span key={x} className={`cg-cell ${ch === "#" ? "lit" : ""}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Candidates({ target, candidates }: { target: JsonValue; candidates: readonly JsonValue[] }) {
  const render = (v: JsonValue | undefined) => {
    if (v === undefined || v === null) return null;
    if (isGridRows(v)) return <CellGrid rows={v} />;
    if (Array.isArray(v)) return <span className="glyphs">{v.map(itemText).join(" ")}</span>;
    return <span>{itemText(v)}</span>;
  };
  return (
    <div className="candidates">
      <div className="candidate target">
        <span className="field-name">Target</span>
        {render(target)}
      </div>
      {candidates.map((cand, i) => {
        const o = isObj(cand) ? cand : {};
        return (
          <div key={i} className="candidate">
            <span className="field-name">{String(o.id ?? i + 1)}</span>
            {render(o.rows ?? o.glyphs ?? cand)}
          </div>
        );
      })}
    </div>
  );
}

function RouteGraph({ content, path, onNode }: { content: Obj; path: readonly string[]; onNode?: (id: string) => void }) {
  const nodes = (content.nodes as Obj[]).map((n) => ({ id: String(n.id), x: Number(n.x), y: Number(n.y) }));
  const edges = (content.edges as Obj[]).map((e) => ({ a: String(e.a), b: String(e.b), blocked: Boolean(e.blocked) }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const maxX = Math.max(...nodes.map((n) => n.x), 1);
  const maxY = Math.max(...nodes.map((n) => n.y), 1);
  const S = 70;
  const px = (n: { x: number }) => 30 + n.x * S;
  const py = (n: { y: number }) => 30 + n.y * S;
  const onPath = (a: string, b: string) => path.some((p, i) => i > 0 && ((path[i - 1] === a && p === b) || (path[i - 1] === b && p === a)));
  return (
    <svg className="route-graph" viewBox={`0 0 ${60 + maxX * S} ${60 + maxY * S}`} width={60 + maxX * S} height={60 + maxY * S}>
      {edges.map((e, i) => {
        const a = byId.get(e.a)!;
        const b = byId.get(e.b)!;
        return (
          <line
            key={i}
            x1={px(a)}
            y1={py(a)}
            x2={px(b)}
            y2={py(b)}
            className={e.blocked ? "edge blocked" : onPath(e.a, e.b) ? "edge on-path" : "edge"}
          />
        );
      })}
      {nodes.map((n) => (
        <g key={n.id} className={`node ${n.id === content.start ? "start" : ""} ${n.id === content.goal ? "goal" : ""} ${path.includes(n.id) ? "in-path" : ""}`} onClick={() => onNode?.(n.id)}>
          <circle cx={px(n)} cy={py(n)} r={16} />
          <text x={px(n)} y={py(n) + 5} textAnchor="middle">
            {n.id}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Answers

function AnswerInput(props: { view: TaskView; format: AnswerFormat; disabled: boolean; onSubmit: (a: TaskAnswer) => void }) {
  const { format } = props;
  switch (format.type) {
    case "number":
      return <NumberAnswer {...props} />;
    case "text":
      return <TextAnswer {...props} maxLength={format.maxLength} />;
    case "choice":
      return <ChoiceAnswer options={format.options} disabled={props.disabled} onSubmit={props.onSubmit} />;
    case "multi_choice":
      return <MultiChoiceAnswer view={props.view} options={format.options} count={format.count} disabled={props.disabled} onSubmit={props.onSubmit} />;
    case "sequence":
      return <SequenceAnswer length={format.length} alphabet={format.alphabet} disabled={props.disabled} onSubmit={props.onSubmit} />;
    case "ordering":
      return <OrderingAnswer items={format.items} disabled={props.disabled} onSubmit={props.onSubmit} />;
    case "path":
      return <PathAnswer view={props.view} nodes={format.nodes} disabled={props.disabled} onSubmit={props.onSubmit} />;
  }
}

function NumberAnswer(props: { disabled: boolean; onSubmit: (a: TaskAnswer) => void }) {
  const [v, setV] = useState("");
  const n = Number(v);
  const ok = v.trim() !== "" && Number.isFinite(n);
  return (
    <form
      className="answer row"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok && !props.disabled) props.onSubmit(n);
      }}
    >
      <input autoFocus type="number" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} aria-label="Answer" />
      <button className="primary" disabled={!ok || props.disabled}>
        Submit
      </button>
    </form>
  );
}

function TextAnswer(props: { maxLength: number; disabled: boolean; onSubmit: (a: TaskAnswer) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      className="answer row"
      onSubmit={(e) => {
        e.preventDefault();
        if (v && !props.disabled) props.onSubmit(v);
      }}
    >
      <input autoFocus maxLength={props.maxLength} value={v} onChange={(e) => setV(e.target.value)} aria-label="Answer" />
      <button className="primary" disabled={!v || props.disabled}>
        Submit
      </button>
    </form>
  );
}

function ChoiceAnswer(props: { options: readonly TaskOption[]; disabled: boolean; onSubmit: (a: TaskAnswer) => void }) {
  useHotkeys(props.options.length, (i) => !props.disabled && props.onSubmit(props.options[i]!.id));
  return (
    <div className="answer options">
      {props.options.map((o, i) => (
        <button key={o.id} className="option" disabled={props.disabled} onClick={() => props.onSubmit(o.id)}>
          <kbd>{i + 1}</kbd> {o.label}
        </button>
      ))}
    </div>
  );
}

function MultiChoiceAnswer(props: { view: TaskView; options: readonly TaskOption[]; count: number | null; disabled: boolean; onSubmit: (a: TaskAnswer) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : props.count !== null && s.length >= props.count ? s : [...s, id]));
  const ready = props.count === null || sel.length === props.count;
  const c = props.view.content as Obj;
  const columns = Array.isArray(c.columns) ? c.columns.map(String) : null;
  const rows = Array.isArray(c.rows) ? c.rows.map(String) : null;
  const gridIds = columns && rows ? rows.map((r) => columns.map((col) => `${col}${r}`)) : null;
  const isGrid = gridIds !== null && gridIds.flat().every((id) => props.options.some((o) => o.id === id));

  return (
    <div className="answer">
      {isGrid ? (
        <div className="cell-grid big pick">
          <div className="cg-row labels">
            <span className="cg-corner" />
            {columns!.map((col) => (
              <span key={col} className="cg-label">
                {col}
              </span>
            ))}
          </div>
          {gridIds!.map((row, y) => (
            <div key={y} className="cg-row">
              <span className="cg-label">{rows![y]}</span>
              {row.map((id) => (
                <button key={id} className={`cg-cell ${sel.includes(id) ? "lit" : ""}`} aria-label={id} aria-pressed={sel.includes(id)} onClick={() => toggle(id)} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="options">
          {props.options.map((o) => (
            <button key={o.id} className={`option toggle ${sel.includes(o.id) ? "on" : ""}`} aria-pressed={sel.includes(o.id)} onClick={() => toggle(o.id)}>
              {o.label} {sel.includes(o.id) ? "ON" : "OFF"}
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <span className="muted">{props.count !== null ? `${sel.length} / ${props.count} selected` : `${sel.length} selected`}</span>
        <button className="primary" disabled={!ready || props.disabled} onClick={() => props.onSubmit(sel)}>
          Submit
        </button>
      </div>
    </div>
  );
}

function SequenceAnswer(props: { length: number; alphabet: readonly string[]; disabled: boolean; onSubmit: (a: TaskAnswer) => void }) {
  const [seq, setSeq] = useState<string[]>([]);
  const full = seq.length === props.length;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      const key = e.key.toUpperCase();
      const symbol = props.alphabet.find((a) => a.toUpperCase() === key);
      if (symbol !== undefined) setSeq((s) => (s.length < props.length ? [...s, symbol] : s));
      else if (e.key === "Backspace") setSeq((s) => s.slice(0, -1));
      else if (e.key === "Enter" && full && !props.disabled) props.onSubmit(seq);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props, seq, full]);
  return (
    <div className="answer">
      <div className="slots">
        {Array.from({ length: props.length }, (_, i) => (
          <span key={i} className={`slot ${i === seq.length ? "next" : ""}`}>
            {seq[i] ?? ""}
          </span>
        ))}
      </div>
      <div className="keypad">
        {props.alphabet.map((a) => (
          <button key={a} disabled={full} onClick={() => setSeq((s) => [...s, a])}>
            {a}
          </button>
        ))}
        <button onClick={() => setSeq((s) => s.slice(0, -1))} aria-label="Delete">
          ⌫
        </button>
      </div>
      <button className="primary" disabled={!full || props.disabled} onClick={() => props.onSubmit(seq)}>
        Submit
      </button>
    </div>
  );
}

function OrderingAnswer(props: { items: readonly TaskOption[]; disabled: boolean; onSubmit: (a: TaskAnswer) => void }) {
  const [order, setOrder] = useState<string[]>([]);
  const label = (id: string) => props.items.find((i) => i.id === id)?.label ?? id;
  const remaining = props.items.filter((i) => !order.includes(i.id));
  return (
    <div className="answer">
      <p className="muted">Click the items in order, first to last.</p>
      <ol className="ordered">
        {order.map((id) => (
          <li key={id}>
            <button className="option" onClick={() => setOrder((o) => o.filter((x) => x !== id))} title="Remove">
              {label(id)} ✕
            </button>
          </li>
        ))}
      </ol>
      <div className="options">
        {remaining.map((i) => (
          <button key={i.id} className="option" onClick={() => setOrder((o) => [...o, i.id])}>
            {i.label}
          </button>
        ))}
      </div>
      <button className="primary" disabled={remaining.length > 0 || props.disabled} onClick={() => props.onSubmit(order)}>
        Submit
      </button>
    </div>
  );
}

function PathAnswer(props: { view: TaskView; nodes: readonly string[]; disabled: boolean; onSubmit: (a: TaskAnswer) => void }) {
  const c = props.view.content as Obj;
  const start = typeof c.start === "string" ? c.start : null;
  const [path, setPath] = useState<string[]>(start ? [start] : []);
  const add = (id: string) => setPath((p) => (p.at(-1) === id ? p : [...p, id]));
  const hasGraph = Array.isArray(c.nodes) && Array.isArray(c.edges);
  const openLinks = useMemo(() => (Array.isArray(c.edges) ? (c.edges as Obj[]).filter((e) => !e.blocked).map((e) => `${String(e.a)}-${String(e.b)}`) : []), [c.edges]);
  return (
    <div className="answer">
      {hasGraph && <RouteGraph content={c} path={path} onNode={add} />}
      {hasGraph && <p className="muted">Open links: {openLinks.join(", ")}. Click nodes on the graph in order.</p>}
      <div className="path">
        {path.length === 0 ? <span className="muted">No nodes yet</span> : path.join(" → ")}
      </div>
      {!hasGraph && (
        <div className="options">
          {props.nodes.map((n) => (
            <button key={n} className="option" onClick={() => add(n)}>
              {n}
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <button onClick={() => setPath((p) => p.slice(0, -1))} disabled={path.length === 0}>
          Undo
        </button>
        <button onClick={() => setPath(start ? [start] : [])}>Clear</button>
        <button className="primary" disabled={path.length === 0 || props.disabled} onClick={() => props.onSubmit(path)}>
          Submit
        </button>
      </div>
    </div>
  );
}

/** Number keys 1..n pick the n-th option. */
function useHotkeys(n: number, pick: (i: number) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      const i = Number(e.key) - 1;
      if (Number.isInteger(i) && i >= 0 && i < n) pick(i);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n, pick]);
}
