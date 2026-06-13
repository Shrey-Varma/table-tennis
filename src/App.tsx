import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "./api";
import { toEngine } from "./engine";
import type { ApiState } from "./engine";
import { Leaderboard } from "./components/Leaderboard";
import { GamesView } from "./components/GamesView";
import { Profile } from "./components/Profile";
import { Insights } from "./components/Insights";
import { AddPlayerModal, LogGameModal } from "./components/Modals";

type View =
  | { kind: "leaderboard" }
  | { kind: "games" }
  | { kind: "insights" }
  | { kind: "profile"; playerId: string };

export default function App() {
  const [state, setState] = useState<ApiState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "leaderboard" });
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [logGameDefault, setLogGameDefault] = useState<string | null | false>(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api.fetchState());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the league server.");
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000); // keep standings live across devices
    return () => clearInterval(interval);
  }, [refresh]);

  const engine = useMemo(() => (state ? toEngine(state) : null), [state]);

  const mutate = async (fn: () => Promise<ApiState>) => {
    try {
      setState(await fn());
      setError(null);
      return true;
    } catch (e) {
      alert(e instanceof Error ? e.message : "Something went wrong.");
      return false;
    }
  };

  const handleImport = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.players) || !Array.isArray(parsed.games)) throw new Error();
      if (state && state.games.length > 0 && !confirm("Replace the current league with the imported file?")) return;
      await mutate(() => api.importLeague(parsed));
      setView({ kind: "leaderboard" });
    } catch {
      alert("That file isn't a valid Pong Rank backup.");
    }
  };

  const navItems = [
    { key: "leaderboard", label: "Standings" },
    { key: "games", label: "Games" },
    { key: "insights", label: "Insights" },
  ] as const;

  if (error && !state) {
    return (
      <div className="empty" style={{ paddingTop: 120 }}>
        <span className="display">Can't reach the league server</span>
        <p>{error}</p>
        <button className="btn btn-primary" onClick={refresh}>Try again</button>
      </div>
    );
  }
  if (!state || !engine) {
    return <div className="empty" style={{ paddingTop: 120 }}><span className="display">Loading standings…</span></div>;
  }

  return (
    <>
      <header className="topbar">
        <span className="brand"><span className="ball-dot" />Pong Rank</span>
        <nav className="nav" aria-label="Main">
          {navItems.map((n) => (
            <button key={n.key} className={view.kind === n.key ? "active" : ""} onClick={() => setView({ kind: n.key })}>
              {n.label}
            </button>
          ))}
        </nav>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowAddPlayer(true)}>+ Player</button>
          <button className="btn btn-primary btn-sm" onClick={() => setLogGameDefault(null)} disabled={state.players.length < 2}
            title={state.players.length < 2 ? "Add at least two players first" : undefined}>
            + Log game
          </button>
        </div>
      </header>

      <main className="page">
        {view.kind === "leaderboard" && (
          <Leaderboard
            engine={engine}
            onOpenPlayer={(id) => setView({ kind: "profile", playerId: id })}
            onLogGame={() => setLogGameDefault(null)}
            onAddPlayer={() => setShowAddPlayer(true)}
          />
        )}
        {view.kind === "games" && (
          <GamesView
            engine={engine}
            players={state.players}
            onDeleteGame={(id) => mutate(() => api.deleteGame(id))}
            onLogGame={() => setLogGameDefault(null)}
            onOpenPlayer={(id) => setView({ kind: "profile", playerId: id })}
          />
        )}
        {view.kind === "insights" && (
          <Insights engine={engine} players={state.players} onOpenPlayer={(id) => setView({ kind: "profile", playerId: id })} />
        )}
        {view.kind === "profile" && (
          <Profile
            playerId={view.playerId}
            engine={engine}
            players={state.players}
            onBack={() => setView({ kind: "leaderboard" })}
            onOpenPlayer={(id) => setView({ kind: "profile", playerId: id })}
            onLogGame={(defaultA) => setLogGameDefault(defaultA)}
          />
        )}
      </main>

      <footer className="footer-note">
        Ratings by OpenSkill (Bradley-Terry, margin-of-victory enabled) ·{" "}
        <button className="back-link" style={{ margin: 0 }} onClick={() => api.exportLeague()}>Export backup</button>
        {" · "}
        <button className="back-link" style={{ margin: 0 }} onClick={() => fileInput.current?.click()}>Import backup</button>
        {state.games.length === 0 && (
          <>
            {" · "}
            <button className="back-link" style={{ margin: 0 }} onClick={() => mutate(api.seedDemo)}>Load demo season</button>
          </>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImport(f);
            e.target.value = "";
          }}
        />
      </footer>

      {showAddPlayer && (
        <AddPlayerModal
          players={state.players}
          onAdd={async (name) => mutate(() => api.addPlayer(name))}
          onClose={() => setShowAddPlayer(false)}
        />
      )}
      {logGameDefault !== false && state.players.length >= 2 && (
        <LogGameModal
          players={state.players}
          engine={engine}
          defaultA={logGameDefault ?? undefined}
          onLog={async (g) => mutate(() => api.addGame(g))}
          onClose={() => setLogGameDefault(false)}
        />
      )}
    </>
  );
}
