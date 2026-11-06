import { useEffect, useRef, useState, type FormEvent } from "react";

type DoorEntryDialogProps = {
  open: boolean;
  roomName: string;
  errorMessage: string;
  busy: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
};

export function DoorEntryDialog({ open, roomName, errorMessage, busy, onSubmit, onCancel }: DoorEntryDialogProps) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      return;
    }
    setPassword("");
    inputRef.current?.focus();
  }, [open, errorMessage]);

  if (!open) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !password) return;
    const submittedPassword = password;
    setPassword("");
    onSubmit(submittedPassword);
  };

  return (
    <div className="door-dialog-backdrop" role="presentation">
      <section className="door-dialog" role="dialog" aria-modal="true" aria-labelledby="door-dialog-title">
        <p className="eyebrow">LOCKED DOOR</p>
        <h2 id="door-dialog-title">Enter {roomName}</h2>
        <p className="door-dialog-copy">This meeting room needs its password. It is sent only with this entry request.</p>
        <form onSubmit={submit}>
          <label className="field-label" htmlFor="meeting-room-password">Meeting room password</label>
          <input
            ref={inputRef}
            id="meeting-room-password"
            className="text-input"
            type="password"
            autoComplete="current-password"
            maxLength={256}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            data-testid="meeting-room-password"
          />
          {errorMessage ? <p className="error-message door-dialog-error" role="alert">{errorMessage}</p> : null}
          <div className="button-row door-dialog-actions">
            <button className="primary-button" type="submit" disabled={!password || busy}>
              {busy ? "Checking…" : "Enter room"}
            </button>
            <button className="quiet-button" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          </div>
        </form>
      </section>
    </div>
  );
}
