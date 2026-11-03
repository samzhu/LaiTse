import { useEffect, useRef, useState } from "react";

type Member = {
  id: string;
  displayName: string;
};

type RoomEvent = {
  seq: number;
  kind: "member.joined" | "member.left" | "reaction";
  participantId: string;
  displayName: string;
  reaction?: string;
  at: number;
};

type ServerMessage =
  | {
      type: "room.snapshot";
      room: { id: string; name: string };
      members: Member[];
      lastSeq: number;
    }
  | { type: "control.event"; event: RoomEvent }
  | { type: "protocol.error"; code: string; message: string };

type RoomSummary = { id: string; name: string };

export function App() {
  const [displayName, setDisplayName] = useState("");
  const [room, setRoom] = useState<RoomSummary | null>(null);
  const [apiStatus, setApiStatus] = useState("Checking local API…");
  const [connectionStatus, setConnectionStatus] = useState("Not connected");
  const [members, setMembers] = useState<Member[]>([]);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [protocolError, setProtocolError] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const lastSequenceRef = useRef(0);

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/health"), fetch("/api/rooms")])
      .then(async ([healthResponse, roomsResponse]) => {
        if (!healthResponse.ok || !roomsResponse.ok) throw new Error("The local API did not respond.");
        const health = (await healthResponse.json()) as { status: string; persistence: string };
        const rooms = (await roomsResponse.json()) as RoomSummary[];
        if (active) {
          setRoom(rooms[0] ?? null);
          setApiStatus(health.status === "ok" ? `API ready · ${health.persistence}` : "API unavailable");
        }
      })
      .catch(() => {
        if (active) setApiStatus("Local API unavailable");
      });

    return () => {
      active = false;
      socketRef.current?.close();
    };
  }, []);

  const joinRoom = () => {
    if (!room || socketRef.current || !displayName.trim()) return;
    setProtocolError("");
    setEvents([]);
    lastSequenceRef.current = 0;
    setConnectionStatus("Connecting…");

    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${window.location.host}/ws`);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      if (socketRef.current !== socket) return;
      setConnectionStatus("Joining room…");
      socket.send(JSON.stringify({ type: "join", roomId: room.id, displayName: displayName.trim() }));
    });

    socket.addEventListener("message", (messageEvent) => {
      if (socketRef.current !== socket) return;
      let message: ServerMessage;
      try {
        message = JSON.parse(String(messageEvent.data)) as ServerMessage;
      } catch {
        setProtocolError("The server sent a message this page could not read.");
        return;
      }

      if (message.type === "room.snapshot") {
        lastSequenceRef.current = message.lastSeq;
        setMembers(message.members);
        setConnectionStatus(`Connected to ${message.room.name}`);
        return;
      }

      if (message.type === "protocol.error") {
        setProtocolError(message.message);
        return;
      }

      if (message.type === "control.event") {
        const event = message.event;
        if (event.seq <= lastSequenceRef.current) return;
        lastSequenceRef.current = event.seq;
        setEvents((current) => [event, ...current].slice(0, 20));
        setMembers((current) => {
          if (event.kind === "member.joined") {
            return current.some((member) => member.id === event.participantId)
              ? current
              : [...current, { id: event.participantId, displayName: event.displayName }];
          }
          if (event.kind === "member.left") {
            return current.filter((member) => member.id !== event.participantId);
          }
          return current;
        });
      }
    });

    socket.addEventListener("close", () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      setMembers([]);
      setConnectionStatus("Not connected");
    });

    socket.addEventListener("error", () => {
      if (socketRef.current !== socket) return;
      setProtocolError("The room connection could not be opened.");
      setConnectionStatus("Connection failed");
    });
  };

  const sendReaction = (reaction: "wave" | "clap") => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "reaction", reaction }));
    }
  };

  const leaveRoom = () => {
    socketRef.current?.close(1000, "Participant left");
    socketRef.current = null;
    setMembers([]);
    setEvents([]);
    lastSequenceRef.current = 0;
    setConnectionStatus("Not connected");
  };

  const connected = connectionStatus.startsWith("Connected to ");

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="LaiTse home">來坐 <span>LAITSE</span></a>
        <span className="phase-tag">LOCAL POC</span>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">A shared space, in miniature</p>
        <h1 id="page-title">Local room presence</h1>
        <p className="intro-copy">Join the same room from two browsers and see each small moment arrive live.</p>
      </section>

      <section className="workspace" aria-label="Room controls and live state">
        <article className="room-card">
          <div className="room-heading">
            <div>
              <p className="eyebrow">YOUR ROOM</p>
              <h2>{room?.name ?? "Loading room…"}</h2>
            </div>
            <span className={`connection-dot ${connected ? "is-live" : ""}`} aria-hidden="true" />
          </div>

          <div className="room-meta">
            <span className="room-pill">{room ? `/${room.id}` : "Loading"}</span>
            <span>{members.length} {members.length === 1 ? "person" : "people"} here</span>
          </div>

          <div className="divider" />

          <label className="field-label" htmlFor="display-name">Your display name</label>
          <input
            id="display-name"
            className="text-input"
            autoComplete="nickname"
            maxLength={32}
            placeholder="e.g. Ada"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={connected}
          />

          <div className="button-row">
            <button className="primary-button" onClick={joinRoom} disabled={!room || !displayName.trim() || connected || connectionStatus.startsWith("Connecting") || connectionStatus.startsWith("Joining")}>
              Join room
            </button>
            {connected ? (
              <button className="quiet-button" onClick={leaveRoom}>Leave</button>
            ) : null}
          </div>

          <p className="connection-status" role="status">{connectionStatus}</p>
          <p className="api-status">{apiStatus}</p>
          {protocolError ? <p className="error-message" role="alert">{protocolError}</p> : null}

          {connected ? (
            <div className="reaction-box">
              <span>Let the room know you’re here</span>
              <div className="reaction-actions">
                <button className="reaction-button" onClick={() => sendReaction("wave")} aria-label="Send wave reaction">
                  <span aria-hidden="true">👋</span> Wave
                </button>
                <button className="reaction-button" onClick={() => sendReaction("clap")} aria-label="Send clap reaction">
                  <span aria-hidden="true">👏</span> Clap
                </button>
              </div>
            </div>
          ) : null}
        </article>

        <div className="side-column">
          <article className="panel-card members-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">IN THE ROOM</p>
                <h2>People here</h2>
              </div>
              <span className="count-pill">{members.length}</span>
            </div>
            <ul className="member-list" aria-label="Online members">
              {members.length ? members.map((member, index) => (
                <li className="member-row" key={member.id}>
                  <span className={`avatar avatar-${index % 4}`} aria-hidden="true">{member.displayName.slice(0, 1).toUpperCase()}</span>
                  <span className="member-name">{member.displayName}</span>
                  <span className="member-presence">Here</span>
                </li>
              )) : <li className="empty-state">You’ll see people here after they join.</li>}
            </ul>
          </article>

          <article className="panel-card activity-card">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">JUST HAPPENED</p>
                <h2>Room activity</h2>
              </div>
              <span className="live-label"><span /> LIVE</span>
            </div>
            <ol className="event-list" aria-label="Recent room events">
              {events.length ? events.map((event) => (
                <li
                  className="event-row"
                  key={event.seq}
                  data-seq={event.seq}
                  data-kind={event.kind}
                  data-room-id={room?.id ?? ""}
                  data-participant-id={event.participantId}
                  data-display-name={event.displayName}
                  data-reaction={event.reaction ?? ""}
                  data-at={event.at}
                >
                  <span className="event-mark" aria-hidden="true">{event.kind === "reaction" ? "✦" : event.kind === "member.joined" ? "+" : "−"}</span>
                  <span>
                    <strong>{event.displayName}</strong>{" "}
                    {event.kind === "reaction" ? `sent a ${event.reaction}` : event.kind === "member.joined" ? "joined the room" : "left the room"}
                  </span>
                  <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </li>
              )) : <li className="empty-state">Room updates will show up here.</li>}
            </ol>
          </article>
        </div>
      </section>

      <footer className="footer-note">
        <span>Local experiment</span>
        <span>Room members and activity live in this server process and clear when it stops.</span>
      </footer>
    </main>
  );
}
