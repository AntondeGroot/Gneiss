import { useState, useMemo, useEffect } from "react";

// ——— Palette: "darkroom" — inherited from Keeper, charcoal + safelight amber ———
const C = {
  bg: "#131110",
  panel: "#1C1916",
  panel2: "#221E1A",
  line: "#2C2722",
  text: "#EDE6DC",
  dim: "#9A9087",
  faint: "#6E665E",
  amber: "#E5A045",
  amberDeep: "#8A5A1E",
  easy: "#8FAE7E",   // Keeper "keep" green
  medium: "#E5A045", // amber
  hard: "#C9685A",   // Keeper "reject" red
  teal: "#7FA8A0",   // Keeper "print" — used for "standard" tier
};

const FONT_HEAD = "'Fraunces', Georgia, serif";
const FONT_BODY = "'Hanken Grotesk', 'Avenir Next', sans-serif";
const FONT_MONO = "'JetBrains Mono', 'SF Mono', ui-monospace, monospace";

// ——— Tier model: how "core knowledge" resurfaces more often ———
// growth < 1 => intervals grow slower => the card comes back sooner.
const TIERS = {
  core:     { label: "Core",     color: C.amber, note: "asked often" },
  standard: { label: "Standard", color: C.teal,  note: "normal pace" },
  optional: { label: "Good to have", color: C.faint, note: "drifts out" },
};

// "Core emphasis" slider (spread: 0 flat … 1 aggressive) sets the growth spread.
// At spread 0 every tier grows the same; at 1 core comes back much sooner than
// good-to-have. This is the knob behind "grep matters more than java."
function tierGrowth(tier, spread) {
  if (tier === "standard") return 1.0;
  if (tier === "core") return 1 - 0.45 * spread;   // 1.0 → 0.55
  return 1 + 0.8 * spread;                          // 1.0 → 1.8  (optional)
}

// ——— Mock Obsidian vault (stands in for real markdown notes) ———
// ——— Mock Obsidian vault: real markdown, the way the notes actually live ———
// Two card formats are supported, matching the Obsidian SR plugin conventions:
//   inline   →  Question :: Answer
//   block    →  Question / a line with just ? / Answer
// Tier comes from `tier:` frontmatter, or an inline #core / #standard / #optional tag.
const SEED = [
  { note: "grep.md", md: `---
tier: core
---
# grep

Recursively search a string in every file under the current dir? :: grep -r "pattern" .

Show line numbers alongside matches?
?
grep -n "pattern" file

Case-insensitive search? :: grep -i "pattern" file

Show 3 lines of context around each match?
?
grep -C 3 "pattern"   (-A after, -B before)

Print only the lines that do NOT match? :: grep -v "pattern" file
` },
  { note: "git.md", md: `---
tier: core
---
# git cheatsheet

Unstage a file you already added? :: git restore --staged <file>   (old: git reset HEAD)
Change the most recent commit message? :: git commit --amend
Compact one-line-per-commit history? :: git log --oneline
Discard uncommitted changes to a tracked file? :: git restore <file>

Create a branch and switch to it in one step?
?
git switch -c <branch>   (old: checkout -b)

Stage only selected chunks of a file interactively? :: git add -p
` },
  { note: "docker.md", md: `---
tier: standard
---
List currently running containers? :: docker ps      (add -a for all)
Follow the logs of a running container? :: docker logs -f <container>
` },
  { note: "vim.md", md: `---
tier: standard
---
Save and quit from normal mode? :: :wq        (or ZZ)
Delete the current line? :: dd
` },
  { note: "java-generics.md", md: `# Java generics  #optional

Create an immutable list literal? :: List.of(a, b, c)

What does <? extends Number> let you do?
?
Read Numbers out (producer). You can't safely add.

== vs .equals() for objects?
?
== compares references; .equals() compares logical value.
` },
];

// ——— The parser: Obsidian markdown → cards + tier ———
function parseNote(md, filename) {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  let tier = null;
  let i = 0;

  // frontmatter block
  if (lines[0]?.trim() === "---") {
    let j = 1;
    for (; j < lines.length && lines[j].trim() !== "---"; j++) {
      const m = lines[j].match(/^tier:\s*(core|standard|optional)/i);
      if (m) tier = m[1].toLowerCase();
    }
    i = j + 1;
  }
  const body = lines.slice(i);

  // inline #tier tag fallback
  if (!tier) {
    const m = body.join("\n").match(/#(core|standard|optional)\b/i);
    if (m) tier = m[1].toLowerCase();
  }
  tier = tier || "standard";

  const cards = [];
  let inFence = false, buf = [], pendingFront = null;
  const clean = (s) => s.replace(/^#+\s*/, "").replace(/#(core|standard|optional)\b/gi, "").trim();
  const flush = () => {
    if (pendingFront !== null) {
      const back = buf.join("\n").trim();
      if (back) cards.push({ front: pendingFront, back });
      pendingFront = null;
    }
    buf = [];
  };

  for (const line of body) {
    const t = line.trim();
    if (t.startsWith("```")) { inFence = !inFence; buf.push(line); continue; }
    if (inFence) { buf.push(line); continue; }

    if (pendingFront === null && t.includes("::")) {          // inline card
      const idx = line.indexOf("::");
      const front = clean(line.slice(0, idx));
      const back = line.slice(idx + 2).trim();
      if (front && back) cards.push({ front, back });
      buf = [];
      continue;
    }
    if (t === "?") { pendingFront = clean(buf.join(" ")) || null; buf = []; continue; }  // block separator
    if (t === "") { flush(); continue; }
    buf.push(line);
  }
  flush();

  return { note: filename, tier, cards: cards.filter((c) => c.front && c.back) };
}

// ——— rewrite a note's markdown to a new tier (keeps markdown the source of truth) ———
function withTier(md, tier) {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() === "---") {
    let j = 1, found = false;
    for (; j < lines.length && lines[j].trim() !== "---"; j++) {
      if (/^tier:/i.test(lines[j])) { lines[j] = `tier: ${tier}`; found = true; }
    }
    if (!found) lines.splice(1, 0, `tier: ${tier}`);
    return lines.join("\n");
  }
  const stripped = (md || "").replace(/#(core|standard|optional)\b/gi, "").replace(/[ \t]+$/gm, "");
  return `---\ntier: ${tier}\n---\n${stripped.replace(/^\n+/, "")}`;
}

// ——— stable ids so editing a note preserves review progress on unchanged cards ———
let _id = 0;
const makeCard = (note, tier, front, back) =>
  ({ id: _id++, note, tier, front, back, interval: 1, ease: 2.3, due: 0, reps: 0 });

function buildCards() {
  _id = 0;
  const out = [];
  SEED.forEach((n) => {
    const p = parseNote(n.md, n.note);
    p.cards.forEach((c) => out.push(makeCard(n.note, p.tier, c.front, c.back)));
  });
  return out;
}

// re-sync one note's cards after its markdown changes, keeping SR state where the front matches
function reconcileNote(prevCards, note, tier, parsedCards) {
  const old = prevCards.filter((c) => c.note === note);
  const others = prevCards.filter((c) => c.note !== note);
  const next = parsedCards.map((pc) => {
    const match = old.find((o) => o.front === pc.front);
    return match ? { ...match, back: pc.back, tier } : makeCard(note, tier, pc.front, pc.back);
  });
  return [...others, ...next];
}

function schedule(card, rating, spread = 1) {
  const g = tierGrowth(card.tier, spread);
  let { interval, ease } = card;
  if (rating === "hard") {
    ease = Math.max(1.3, ease - 0.2);
    interval = 1;
  } else if (rating === "medium") {
    ease = Math.max(1.3, ease - 0.02);
    interval = Math.max(1, Math.round(interval * ease * g));
  } else { // easy
    ease = ease + 0.1;
    interval = Math.max(2, Math.round(interval * ease * 1.5 * g));
  }
  return { ...card, ease, interval, due: interval, reps: card.reps + 1 };
}

function fmtNext(days) {
  if (days <= 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  if (days < 14) return "in a week";
  if (days < 45) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
}

// ——— tiny inline icons ———
const Ico = {
  flame: (p) => (<svg viewBox="0 0 24 24" width={p.s||18} height={p.s||18} fill="none" stroke={p.c||C.amber} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2c1 3-2 4-2 7a2 2 0 0 0 4 0c0-1 0-1 .5-2 1.5 1.5 2.5 3.5 2.5 6a5 5 0 0 1-10 0c0-4 3-6 5-11z"/></svg>),
  layers: (p) => (<svg viewBox="0 0 24 24" width={p.s||18} height={p.s||18} fill="none" stroke={p.c||C.dim} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>),
  vault: (p) => (<svg viewBox="0 0 24 24" width={p.s||18} height={p.s||18} fill="none" stroke={p.c||C.dim} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16v16H4z"/><path d="M9 4v16M4 9h5"/></svg>),
  check: (p) => (<svg viewBox="0 0 24 24" width={p.s||18} height={p.s||18} fill="none" stroke={p.c||C.easy} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>),
  bell: (p) => (<svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke={p.c||C.dim} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>),
  gear: (p) => (<svg viewBox="0 0 24 24" width={p.s||18} height={p.s||18} fill="none" stroke={p.c||C.dim} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>),
  back: (p) => (<svg viewBox="0 0 24 24" width={p.s||22} height={p.s||22} fill="none" stroke={p.c||C.dim} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>),
  chev: (p) => (<svg viewBox="0 0 24 24" width={p.s||16} height={p.s||16} fill="none" stroke={p.c||C.faint} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>),
};

export default function Gneiss() {
  const [cards, setCards] = useState(buildCards);
  const [tab, setTab] = useState("today");
  const [streak, setStreak] = useState(6);
  const [reviewedToday, setReviewedToday] = useState(false);
  const [remindOn, setRemindOn] = useState(true);
  const [remindAt, setRemindAt] = useState("08:30");
  // settings
  const [spread, setSpread] = useState(0.8);   // core emphasis, 0..1
  const [newPerDay, setNewPerDay] = useState(8);
  // note markdown sources (the vault) — markdown is the source of truth
  const [noteSources, setNoteSources] = useState(
    () => Object.fromEntries(SEED.map((n) => [n.note, n.md]))
  );

  // review session
  const [session, setSession] = useState(null); // {queue:[ids], i, revealed, tally}

  // Effective daily queue: all due reviews, plus at most newPerDay brand-new cards.
  const dueOrdered = useMemo(() => {
    const rank = { core: 0, standard: 1, optional: 2 };
    const byRank = (a, b) => rank[a.tier] - rank[b.tier] || a.id - b.id;
    const allDue = cards.filter((c) => c.due <= 0);
    const reviews = allDue.filter((c) => c.reps > 0);
    const fresh = allDue.filter((c) => c.reps === 0).sort(byRank).slice(0, newPerDay);
    return [...reviews, ...fresh].sort(byRank);
  }, [cards, newPerDay]);
  const due = dueOrdered;

  const byTier = useMemo(() => {
    const t = { core: 0, standard: 0, optional: 0 };
    due.forEach((c) => t[c.tier]++);
    return t;
  }, [due]);

  function startReview() {
    if (dueOrdered.length === 0) return;
    setSession({ queue: dueOrdered.map((c) => c.id), i: 0, revealed: false, tally: { easy: 0, medium: 0, hard: 0 }, results: [] });
    setTab("review");
  }

  function rate(rating) {
    setSession((s) => {
      const cardId = s.queue[s.i];
      const card = cards.find((c) => c.id === cardId);
      const updated = schedule(card, rating, spread);
      setCards((cs) => cs.map((c) => (c.id === cardId ? updated : c)));
      const tally = { ...s.tally, [rating]: s.tally[rating] + 1 };
      const results = [...s.results, { note: card.note, tier: card.tier, next: updated.interval, rating }];
      const nextI = s.i + 1;
      if (nextI >= s.queue.length && !reviewedToday) {
        setReviewedToday(true);
        setStreak((v) => v + 1);
      }
      return { ...s, i: nextI, revealed: false, tally, results };
    });
  }

  function saveNote(note, md) {
    const parsed = parseNote(md, note);
    setNoteSources((s) => ({ ...s, [note]: md }));
    setCards((prev) => reconcileNote(prev, note, parsed.tier, parsed.cards));
  }
  function setNoteTier(note, tier) {
    saveNote(note, withTier(noteSources[note], tier));
  }

  const shell = {
    maxWidth: 430, margin: "0 auto", minHeight: "100vh", background: C.bg,
    color: C.text, fontFamily: FONT_BODY, position: "relative", paddingBottom: 84,
  };

  return (
    <div style={{ background: C.bg, minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Hanken+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
        button { font-family: inherit; cursor: pointer; border: none; }
        @keyframes rise { from { opacity: 0; transform: translateY(8px);} to {opacity:1; transform:none;} }
        @keyframes flip { from { opacity: 0; transform: translateY(6px);} to {opacity:1; transform:none;} }
        @media (prefers-reduced-motion: reduce){ *{animation:none !important;} }
      `}</style>

      <div style={shell}>
        {tab === "today" && (
          <Today streak={streak} due={due} byTier={byTier} onStart={startReview}
            reviewedToday={reviewedToday} onSettings={() => setTab("settings")} />
        )}
        {tab === "review" && (
          <Review session={session} cards={cards} spread={spread}
            onReveal={() => setSession((s) => ({ ...s, revealed: true }))}
            onRate={rate} onDone={() => setTab("today")} />
        )}
        {tab === "vault" && (
          <Vault cards={cards} noteSources={noteSources} setNoteTier={setNoteTier} onSaveNote={saveNote} />
        )}
        {tab === "settings" && (
          <Settings onBack={() => setTab("today")} onOpenVault={() => setTab("vault")}
            remindOn={remindOn} setRemindOn={setRemindOn} remindAt={remindAt} setRemindAt={setRemindAt}
            spread={spread} setSpread={setSpread} newPerDay={newPerDay} setNewPerDay={setNewPerDay} />
        )}

        {tab !== "review" && tab !== "settings" && <TabBar tab={tab} setTab={setTab} due={due.length} />}
      </div>
    </div>
  );
}

// ————————————————————————— TODAY —————————————————————————
function Today({ streak, due, byTier, onStart, reviewedToday, onSettings }) {
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
  return (
    <div style={{ padding: "26px 22px 0", animation: "rise .4s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: C.faint }}>Gneiss</span>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: C.amber, fontWeight: 600 }}>
            <Ico.flame /> {streak}
          </div>
          <button onClick={onSettings} aria-label="Settings" style={{ background: "none", padding: 4, display: "flex" }}>
            <Ico.gear s={20} />
          </button>
        </div>
      </div>

      <h1 style={{ fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 30, lineHeight: 1.1, margin: "22px 0 4px" }}>
        {greet}. {reviewedToday ? "Vault reviewed." : `${due.length} cards ready.`}
      </h1>
      <p style={{ color: C.dim, margin: "0 0 26px", fontSize: 15 }}>
        {reviewedToday
          ? "Nice — the streak holds. New cards surface tomorrow."
          : "Pulled from your Obsidian vault, weighted toward what you use daily."}
      </p>

      {/* the ring */}
      <DueRing due={due.length} byTier={byTier} />

      {/* tier legend */}
      <div style={{ display: "flex", gap: 8, margin: "20px 0 24px" }}>
        {Object.entries(TIERS).map(([k, t]) => (
          <div key={k} style={{ flex: 1, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 8, background: t.color }} />
              <span style={{ fontSize: 12.5, color: C.dim }}>{t.label}</span>
            </div>
            <div style={{ fontFamily: FONT_HEAD, fontSize: 24, marginTop: 4 }}>{byTier[k]}</div>
          </div>
        ))}
      </div>

      <button onClick={onStart} disabled={due.length === 0}
        style={{
          width: "100%", padding: "17px", borderRadius: 14, fontSize: 16, fontWeight: 600,
          color: due.length ? C.bg : C.faint,
          background: due.length ? C.amber : C.panel,
          border: due.length ? "none" : `1px solid ${C.line}`,
          boxShadow: due.length ? "0 8px 24px rgba(229,160,69,.22)" : "none",
        }}>
        {due.length ? `Start review · ${due.length}` : "All caught up"}
      </button>
    </div>
  );
}

function DueRing({ due, byTier }) {
  const total = Math.max(due, 1);
  const R = 52, CIRC = 2 * Math.PI * R;
  const segs = ["core", "standard", "optional"];
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 22, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: "22px 20px" }}>
      <svg width="128" height="128" viewBox="0 0 128 128" style={{ flexShrink: 0 }}>
        <circle cx="64" cy="64" r={R} fill="none" stroke={C.line} strokeWidth="12" />
        {segs.map((k) => {
          const frac = byTier[k] / total;
          const len = frac * CIRC;
          const el = (
            <circle key={k} cx="64" cy="64" r={R} fill="none" stroke={TIERS[k].color} strokeWidth="12"
              strokeDasharray={`${len} ${CIRC - len}`} strokeDashoffset={-offset}
              transform="rotate(-90 64 64)" strokeLinecap="butt" />
          );
          offset += len;
          return el;
        })}
        <text x="64" y="60" textAnchor="middle" fontFamily={FONT_HEAD} fontSize="34" fill={C.text}>{due}</text>
        <text x="64" y="80" textAnchor="middle" fontFamily={FONT_BODY} fontSize="11" fill={C.faint} letterSpacing="1">DUE TODAY</text>
      </svg>
      <div style={{ fontSize: 13.5, color: C.dim, lineHeight: 1.7 }}>
        <div><b style={{ color: C.amber }}>{byTier.core}</b> core — the daily-driver stuff</div>
        <div><b style={{ color: C.teal }}>{byTier.standard}</b> standard practice</div>
        <div><b style={{ color: C.faint }}>{byTier.optional}</b> good-to-have</div>
      </div>
    </div>
  );
}

// ————————————————————————— REVIEW —————————————————————————
function Review({ session, cards, spread = 1, onReveal, onRate, onDone }) {
  if (!session) return null;
  const done = session.i >= session.queue.length;

  if (done) return <ReviewDone session={session} onDone={onDone} />;

  const card = cards.find((c) => c.id === session.queue[session.i]);
  const tier = TIERS[card.tier];
  const progress = session.i / session.queue.length;

  return (
    <div style={{ padding: "22px 22px 0", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* progress */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={onDone} style={{ background: "none", color: C.faint, fontSize: 22, lineHeight: 1, padding: 0 }}>×</button>
        <div style={{ flex: 1, height: 5, background: C.line, borderRadius: 5, overflow: "hidden" }}>
          <div style={{ width: `${progress * 100}%`, height: "100%", background: C.amber, transition: "width .3s ease" }} />
        </div>
        <span style={{ fontSize: 12.5, color: C.faint, fontFamily: FONT_MONO }}>{session.i + 1}/{session.queue.length}</span>
      </div>

      {/* card */}
      <div key={card.id} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", animation: "rise .35s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: tier.color, border: `1px solid ${tier.color}55`, borderRadius: 20, padding: "3px 10px" }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: tier.color }} />
            {tier.label} · {tier.note}
          </span>
          <span style={{ fontSize: 12, color: C.faint, fontFamily: FONT_MONO }}>{card.note}</span>
        </div>

        <div style={{ fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 25, lineHeight: 1.25 }}>
          {card.front}
        </div>

        {session.revealed && (
          <div style={{ marginTop: 22, padding: "18px 18px", background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, animation: "flip .3s ease" }}>
            <div style={{ fontSize: 11, letterSpacing: 1.5, color: C.faint, textTransform: "uppercase", marginBottom: 8 }}>Answer</div>
            <code style={{ fontFamily: FONT_MONO, fontSize: 15.5, color: C.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{card.back}</code>
          </div>
        )}
      </div>

      {/* controls */}
      <div style={{ paddingBottom: 24 }}>
        {!session.revealed ? (
          <button onClick={onReveal}
            style={{ width: "100%", padding: 17, borderRadius: 14, fontSize: 16, fontWeight: 600, color: C.text, background: C.panel2, border: `1px solid ${C.line}` }}>
            Show answer
          </button>
        ) : (
          <div>
            <div style={{ textAlign: "center", fontSize: 12.5, color: C.faint, marginBottom: 10 }}>How well did you know it?</div>
            <div style={{ display: "flex", gap: 10 }}>
              <RateBtn label="Difficult" sub={`next ${fmtNext(schedule(card,"hard",spread).interval)}`} color={C.hard} onClick={() => onRate("hard")} />
              <RateBtn label="Medium" sub={`next ${fmtNext(schedule(card,"medium",spread).interval)}`} color={C.medium} onClick={() => onRate("medium")} />
              <RateBtn label="Easy" sub={`next ${fmtNext(schedule(card,"easy",spread).interval)}`} color={C.easy} onClick={() => onRate("easy")} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RateBtn({ label, sub, color, onClick }) {
  return (
    <button onClick={onClick}
      style={{ flex: 1, padding: "13px 6px", borderRadius: 13, background: C.panel, border: `1px solid ${color}66`, color: C.text, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
      <span style={{ fontWeight: 600, fontSize: 14.5, color }}>{label}</span>
      <span style={{ fontSize: 10.5, color: C.faint, fontFamily: FONT_MONO }}>{sub}</span>
    </button>
  );
}

function ReviewDone({ session, onDone }) {
  const { tally } = session;
  const total = tally.easy + tally.medium + tally.hard;
  const coreHit = session.results.filter((r) => r.tier === "core").length;
  return (
    <div style={{ padding: "60px 26px", minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", animation: "rise .4s ease" }}>
      <div style={{ width: 56, height: 56, borderRadius: 56, background: `${C.easy}22`, border: `1px solid ${C.easy}66`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 22 }}>
        <Ico.check s={26} />
      </div>
      <h1 style={{ fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 30, margin: "0 0 6px" }}>Session done.</h1>
      <p style={{ color: C.dim, margin: "0 0 30px", fontSize: 15 }}>
        {total} cards reviewed, {coreHit} of them core knowledge. Streak protected for the day.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 30 }}>
        {[["Difficult", tally.hard, C.hard], ["Medium", tally.medium, C.medium], ["Easy", tally.easy, C.easy]].map(([l, n, c]) => (
          <div key={l} style={{ flex: 1, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 10px", textAlign: "center" }}>
            <div style={{ fontFamily: FONT_HEAD, fontSize: 26, color: c }}>{n}</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{l}</div>
          </div>
        ))}
      </div>

      <button onClick={onDone}
        style={{ width: "100%", padding: 16, borderRadius: 14, fontSize: 16, fontWeight: 600, color: C.bg, background: C.amber }}>
        Back to Today
      </button>
    </div>
  );
}

// ————————————————————————— VAULT —————————————————————————
function Vault({ cards, noteSources, setNoteTier, onSaveNote }) {
  const [editing, setEditing] = useState(null); // note filename or null

  const notes = useMemo(() => {
    const m = {};
    cards.forEach((c) => {
      if (!m[c.note]) m[c.note] = { note: c.note, tier: c.tier, count: 0, due: 0 };
      m[c.note].count++;
      if (c.due <= 0) m[c.note].due++;
    });
    return Object.values(m);
  }, [cards]);

  if (editing) {
    return <NoteEditor note={editing} md={noteSources[editing]}
      onBack={() => setEditing(null)}
      onSave={(md) => { onSaveNote(editing, md); setEditing(null); }} />;
  }

  return (
    <div style={{ padding: "26px 22px 0", animation: "rise .4s ease" }}>
      <h1 style={{ fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 26, margin: "0 0 4px" }}>Vault</h1>
      <p style={{ color: C.dim, margin: "0 0 8px", fontSize: 14.5 }}>
        Notes synced from Obsidian. Tap a note to see how its cards are parsed, or set its tier.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 7, color: C.easy, fontSize: 12.5, marginBottom: 22 }}>
        <span style={{ width: 7, height: 7, borderRadius: 7, background: C.easy }} />
        Synced · vault on this device · 2 min ago
      </div>

      {notes.map((n) => (
        <div key={n.note} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "15px 16px", marginBottom: 12 }}>
          <button onClick={() => setEditing(n.note)}
            style={{ width: "100%", background: "none", padding: 0, display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: 14.5, color: C.text }}>{n.note}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: C.faint }}>{n.count} cards · {n.due} due</span>
              <Ico.chev />
            </span>
          </button>
          <div style={{ display: "flex", gap: 6 }}>
            {Object.entries(TIERS).map(([k, t]) => {
              const active = n.tier === k;
              return (
                <button key={k} onClick={() => setNoteTier(n.note, k)}
                  style={{
                    flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 12.5,
                    color: active ? C.bg : C.dim,
                    background: active ? t.color : C.panel2,
                    border: `1px solid ${active ? t.color : C.line}`,
                    fontWeight: active ? 600 : 400,
                  }}>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <p style={{ color: C.faint, fontSize: 12.5, lineHeight: 1.6, marginTop: 8 }}>
        Cards are read from <code style={{ fontFamily: FONT_MONO, color: C.dim }}>Q :: A</code> lines and
        {" "}<code style={{ fontFamily: FONT_MONO, color: C.dim }}>?</code>-separated blocks in each note. Edit a note and its cards re-sync.
      </p>
    </div>
  );
}

function NoteEditor({ note, md, onBack, onSave }) {
  const [draft, setDraft] = useState(md);
  const parsed = useMemo(() => parseNote(draft, note), [draft, note]);
  const dirty = draft !== md;
  const tier = TIERS[parsed.tier];

  return (
    <div style={{ animation: "rise .3s ease" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "22px 18px 6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <button onClick={onBack} aria-label="Back" style={{ background: "none", padding: 4, display: "flex" }}><Ico.back /></button>
          <span style={{ fontFamily: FONT_MONO, fontSize: 15, color: C.text, overflow: "hidden", textOverflow: "ellipsis" }}>{note}</span>
        </div>
        <button onClick={() => onSave(draft)} disabled={!dirty}
          style={{ padding: "8px 16px", borderRadius: 10, fontSize: 13.5, fontWeight: 600,
            color: dirty ? C.bg : C.faint, background: dirty ? C.amber : C.panel, border: dirty ? "none" : `1px solid ${C.line}` }}>
          {dirty ? "Sync" : "Synced"}
        </button>
      </div>

      <div style={{ padding: "10px 18px 40px" }}>
        {/* detected tier */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0 12px" }}>
          <span style={{ fontSize: 12, color: C.faint }}>Detected tier</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: tier.color, border: `1px solid ${tier.color}55`, borderRadius: 20, padding: "2px 9px" }}>
            <span style={{ width: 6, height: 6, borderRadius: 6, background: tier.color }} />{tier.label}
          </span>
          <span style={{ fontSize: 12, color: C.faint, marginLeft: "auto" }}>{parsed.cards.length} cards</span>
        </div>

        {/* markdown source */}
        <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.faint, margin: "6px 2px" }}>Note source</div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false}
          style={{ width: "100%", minHeight: 200, resize: "vertical", background: C.panel, color: C.text,
            border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px", fontFamily: FONT_MONO, fontSize: 13, lineHeight: 1.7 }} />

        {/* live parsed cards */}
        <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.faint, margin: "20px 2px 8px" }}>
          Parsed cards · updates as you type
        </div>
        {parsed.cards.length === 0 ? (
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "18px 16px", color: C.dim, fontSize: 13.5 }}>
            No cards found yet. Write a line like <code style={{ fontFamily: FONT_MONO, color: C.text }}>Question :: Answer</code>, or a question, then a line with just <code style={{ fontFamily: FONT_MONO, color: C.text }}>?</code>, then the answer.
          </div>
        ) : parsed.cards.map((c, i) => (
          <div key={i} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", marginBottom: 8 }}>
            <div style={{ fontSize: 14, color: C.text, lineHeight: 1.4 }}>{c.front}</div>
            <code style={{ display: "block", fontFamily: FONT_MONO, fontSize: 13, color: tier.color, marginTop: 6, whiteSpace: "pre-wrap" }}>{c.back}</code>
          </div>
        ))}
      </div>
    </div>
  );
}

// ————————————————————————— SETTINGS —————————————————————————
function Settings({ onBack, onOpenVault, remindOn, setRemindOn, remindAt, setRemindAt, spread, setSpread, newPerDay, setNewPerDay }) {
  // live preview of what the emphasis knob does to a fresh card's next interval
  const sample = { interval: 1, ease: 2.3, reps: 0 };
  const previewCore = schedule({ ...sample, tier: "core" }, "medium", spread).interval;
  const previewOpt = schedule({ ...sample, tier: "optional" }, "medium", spread).interval;
  const emphasisLabel = spread < 0.25 ? "Flat" : spread < 0.6 ? "Balanced" : spread < 0.9 ? "High" : "Aggressive";

  return (
    <div style={{ animation: "rise .35s ease" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "22px 18px 6px" }}>
        <button onClick={onBack} aria-label="Back" style={{ background: "none", padding: 4, display: "flex" }}>
          <Ico.back />
        </button>
        <h1 style={{ fontFamily: FONT_HEAD, fontWeight: 500, fontSize: 24, margin: 0 }}>Settings</h1>
      </div>

      <div style={{ padding: "12px 22px 40px" }}>
        {/* — Reminder — */}
        <SectionLabel>Daily habit</SectionLabel>
        <Card>
          <Row>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <Ico.bell c={remindOn ? C.amber : C.faint} />
              <span style={{ fontSize: 14.5, color: remindOn ? C.text : C.dim }}>Reminder to review</span>
            </div>
            <Toggle on={remindOn} onClick={() => setRemindOn((v) => !v)} />
          </Row>
          {remindOn && (
            <Row top>
              <span style={{ fontSize: 13.5, color: C.dim }}>Nudge me at</span>
              <input type="time" value={remindAt} onChange={(e) => setRemindAt(e.target.value)}
                style={{ background: C.panel2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", fontFamily: FONT_MONO, fontSize: 14 }} />
            </Row>
          )}
        </Card>

        {/* — New cards per day — */}
        <SectionLabel>Pace</SectionLabel>
        <Card>
          <Row>
            <div>
              <div style={{ fontSize: 14.5, color: C.text }}>New cards per day</div>
              <div style={{ fontSize: 12.5, color: C.faint, marginTop: 2 }}>How many unseen cards to introduce daily</div>
            </div>
            <Stepper value={newPerDay} min={0} max={40} step={2} onChange={setNewPerDay} />
          </Row>
        </Card>

        {/* — Core emphasis — */}
        <SectionLabel>Core emphasis</SectionLabel>
        <Card>
          <Row>
            <span style={{ fontSize: 14.5, color: C.text }}>How hard core outpaces the rest</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.amber }}>{emphasisLabel}</span>
          </Row>
          <input type="range" min={0} max={1} step={0.05} value={spread}
            onChange={(e) => setSpread(parseFloat(e.target.value))}
            style={{ width: "100%", marginTop: 14, accentColor: C.amber }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.faint, marginTop: 2 }}>
            <span>Flat — tiers even</span>
            <span>Aggressive</span>
          </div>
          {/* live effect */}
          <div style={{ marginTop: 16, background: C.panel2, borderRadius: 10, padding: "12px 14px", fontSize: 13, color: C.dim, lineHeight: 1.7 }}>
            A card you rate <span style={{ color: C.medium }}>Medium</span> comes back:
            <div style={{ marginTop: 6, display: "flex", gap: 18 }}>
              <span><span style={{ color: C.amber }}>●</span> core <b style={{ color: C.text }}>{fmtNext(previewCore)}</b></span>
              <span><span style={{ color: C.faint }}>●</span> good-to-have <b style={{ color: C.text }}>{fmtNext(previewOpt)}</b></span>
            </div>
          </div>
        </Card>

        <button onClick={onOpenVault}
          style={{ width: "100%", marginTop: 10, background: "none", border: "none", color: C.dim, fontSize: 13.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0" }}>
          Set which notes are core in the Vault
          <span style={{ color: C.amber }}>→</span>
        </button>

        <p style={{ fontSize: 12.5, color: C.faint, lineHeight: 1.6, marginTop: 6 }}>
          Emphasis and pace apply from your next review.
        </p>
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <div style={{ fontSize: 11.5, letterSpacing: 1.5, textTransform: "uppercase", color: C.faint, margin: "18px 2px 8px" }}>{children}</div>;
}
function Card({ children }) {
  return <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "6px 16px" }}>{children}</div>;
}
function Row({ children, top }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderTop: top ? `1px solid ${C.line}` : "none" }}>{children}</div>;
}
function Stepper({ value, min, max, step, onChange }) {
  const btn = (dis) => ({ width: 32, height: 32, borderRadius: 9, background: C.panel2, color: dis ? C.faint : C.text, border: `1px solid ${C.line}`, fontSize: 18, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button disabled={value <= min} style={btn(value <= min)} onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <span style={{ fontFamily: FONT_HEAD, fontSize: 20, minWidth: 24, textAlign: "center" }}>{value}</span>
      <button disabled={value >= max} style={btn(value >= max)} onClick={() => onChange(Math.min(max, value + step))}>+</button>
    </div>
  );
}

// ————————————————————————— CHROME —————————————————————————
function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick} style={{ width: 44, height: 26, borderRadius: 26, background: on ? C.amber : C.line, position: "relative", transition: "background .2s", padding: 0 }}>
      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 20, background: on ? C.bg : C.dim, transition: "left .2s" }} />
    </button>
  );
}

function TabBar({ tab, setTab, due }) {
  const items = [
    ["today", "Today", Ico.flame],
    ["vault", "Vault", Ico.vault],
  ];
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, maxWidth: 430, margin: "0 auto", background: `${C.panel}f2`, borderTop: `1px solid ${C.line}`, backdropFilter: "blur(10px)", display: "flex", padding: "10px 0 14px" }}>
      {items.map(([k, label, I]) => {
        const active = tab === k;
        return (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, background: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, position: "relative" }}>
            <I c={active ? C.amber : C.faint} s={20} />
            <span style={{ fontSize: 11, color: active ? C.amber : C.faint }}>{label}</span>
            {k === "today" && due > 0 && (
              <span style={{ position: "absolute", top: -3, right: "calc(50% - 22px)", background: C.hard, color: C.text, fontSize: 10, minWidth: 16, height: 16, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{due}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
