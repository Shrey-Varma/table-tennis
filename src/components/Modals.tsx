import { useMemo, useState } from "react";
import { matchupProbability } from "../engine";
import type { EngineResult } from "../engine";
import type { Player } from "../types";
import { pct } from "./common";

export function AddPlayerModal({
  players,
  onAdd,
  onClose,
}: {
  players: Player[];
  onAdd: (name: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the player a name.");
    if (players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase()))
      return setError("That name is already on the board.");
    setBusy(true);
    if (await onAdd(trimmed)) onClose();
    setBusy(false);
  };

  return (
    <Backdrop onClose={onClose}>
      <h3>Add player</h3>
      <div className="field">
        <label htmlFor="pname">Name</label>
        <input
          id="pname"
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. Shrey"
        />
      </div>
      {error && <p className="error-text">{error}</p>}
      <p className="hint-text">New players start at μ 25.0, σ 8.33 and stay provisional for their first 5 games.</p>
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>Add player</button>
      </div>
    </Backdrop>
  );
}

export function LogGameModal({
  players,
  engine,
  defaultA,
  onLog,
  onClose,
}: {
  players: Player[];
  engine: EngineResult;
  defaultA?: string;
  onLog: (g: { aId: string; bId: string; aScore: number; bScore: number; target: 11 | 21 }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [aId, setAId] = useState(defaultA ?? players[0]?.id ?? "");
  const [bId, setBId] = useState(players.find((p) => p.id !== (defaultA ?? players[0]?.id))?.id ?? "");
  const [aScore, setAScore] = useState("");
  const [bScore, setBScore] = useState("");
  const [target, setTarget] = useState<11 | 21>(11);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const probA = useMemo(() => {
    if (!aId || !bId || aId === bId) return null;
    return matchupProbability(engine, aId, bId);
  }, [aId, bId, engine]);

  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? "?";

  const submit = async () => {
    const a = parseInt(aScore, 10);
    const b = parseInt(bScore, 10);
    if (!aId || !bId) return setError("Pick both players.");
    if (aId === bId) return setError("A player can't play themselves — pick two different people.");
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0) return setError("Enter both scores.");
    if (a === b) return setError("Table tennis games can't end in a tie.");
    const hi = Math.max(a, b);
    const lo = Math.min(a, b);
    if (hi < target) return setError(`The winner needs at least ${target} points in a game to ${target}.`);
    if (hi > target && hi - lo !== 2)
      return setError(`Past ${target}, games end on a 2-point lead (e.g. ${target + 4}–${target + 2}).`);
    if (hi === target && hi - lo < 2 && lo !== target - 1)
      return setError(`A ${target}–${lo} score isn't possible — at ${target - 1}-all the game goes to deuce.`);
    setBusy(true);
    if (await onLog({ aId, bId, aScore: a, bScore: b, target })) onClose();
    setBusy(false);
  };

  return (
    <Backdrop onClose={onClose}>
      <h3>Log game</h3>
      <div className="field-row">
        <div className="field">
          <label htmlFor="pa">Player A</label>
          <select id="pa" value={aId} onChange={(e) => { setAId(e.target.value); setError(""); }}>
            {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pb">Player B</label>
          <select id="pb" value={bId} onChange={(e) => { setBId(e.target.value); setError(""); }}>
            {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {probA !== null && (
        <div className="stakes" style={{ marginBottom: 14 }}>
          <span className="display">{nameOf(aId)} {pct(probA)}</span>
          {" — "}
          <span className="display">{pct(1 - probA)} {nameOf(bId)}</span>
          <div style={{ marginTop: 6 }} className="prob-bar"><div style={{ width: `${probA * 100}%` }} /></div>
          <div style={{ marginTop: 6 }}>Pre-game odds. Upsets and big margins move ratings the most.</div>
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="sa">{nameOf(aId)}'s score</label>
          <input id="sa" inputMode="numeric" value={aScore} onChange={(e) => { setAScore(e.target.value); setError(""); }} placeholder="11" />
        </div>
        <div className="field">
          <label htmlFor="sb">{nameOf(bId)}'s score</label>
          <input id="sb" inputMode="numeric" value={bScore} onChange={(e) => { setBScore(e.target.value); setError(""); }} placeholder="7" />
        </div>
      </div>

      <div className="field">
        <label>Game to</label>
        <div className="seg" role="radiogroup" aria-label="Points to win">
          <button className={target === 11 ? "on" : ""} onClick={() => setTarget(11)} role="radio" aria-checked={target === 11}>11 points</button>
          <button className={target === 21 ? "on" : ""} onClick={() => setTarget(21)} role="radio" aria-checked={target === 21}>21 points</button>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>Log game</button>
      </div>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}
