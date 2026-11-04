import { useEffect, useRef } from "react";
import { participantJoinUrl, type ParticipationMode } from "./entry";
import { drawQrMatrix } from "./qr";

type JoinQrProps = {
  roomId: string;
  mode?: ParticipationMode;
};

export function JoinQr({ roomId, mode = "interaction" }: JoinQrProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const url = participantJoinUrl(roomId, mode);

  useEffect(() => {
    if (canvasRef.current) drawQrMatrix(canvasRef.current, url);
  }, [url]);

  return (
    <section className="panel-card join-qr" aria-labelledby="join-qr-title" data-testid="join-qr">
      <div>
        <p className="eyebrow">JOIN THIS ROOM</p>
        <h2 id="join-qr-title">掃描加入</h2>
        <p>連結只包含房間和只互動模式。加入時仍會依房間設定檢查密碼。</p>
      </div>
      <canvas ref={canvasRef} className="join-qr-canvas" data-testid="join-qr-canvas" aria-label={`加入 ${roomId} 的 QR Code`} />
      <a className="join-qr-link" data-testid="join-qr-link" href={url}>{url}</a>
    </section>
  );
}
