"use client";

// A signature the signer actually makes: drawn with mouse, finger or stylus, or
// typed and rendered in a script face. Either way the result is a PNG in dark
// ink on a transparent background, so it prints on a white page. The server
// re-validates it and stamps it into the PDF; this component only captures.
import { useCallback, useEffect, useRef, useState } from "react";

type Tab = "draw" | "type";
const INK = "#111827";
const W = 800;
const H = 240;

export function SignaturePad({
  signerName,
  onChange,
  label = "Signature",
}: {
  signerName: string;
  /** A PNG data URL once there is a signature, null while the pad is empty. */
  onChange: (dataUrl: string | null) => void;
  label?: string;
}) {
  const [tab, setTab] = useState<Tab>("draw");
  const [typed, setTyped] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const hasInk = useRef(false);

  // The script face for typed signatures.
  useEffect(() => {
    const link = document.createElement("link");
    link.href = "https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  const clearCanvas = useCallback(() => {
    const c = canvasRef.current;
    c?.getContext("2d")?.clearRect(0, 0, W, H);
    hasInk.current = false;
    onChange(null);
  }, [onChange]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pos(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.6, 0, Math.PI * 2);
    ctx.fill();
    hasInk.current = true;
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = pos(e);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (hasInk.current) onChange(canvasRef.current!.toDataURL("image/png"));
  }

  function renderTyped(text: string) {
    const t = text.trim();
    if (!t) {
      onChange(null);
      return;
    }
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = INK;
    ctx.font = "96px 'Dancing Script', Georgia, cursive";
    ctx.textBaseline = "middle";
    // Shrink to fit rather than clip a long name.
    let size = 96;
    while (ctx.measureText(t).width > W - 40 && size > 28) {
      size -= 4;
      ctx.font = `${size}px 'Dancing Script', Georgia, cursive`;
    }
    ctx.fillText(t, 20, H / 2);
    onChange(c.toDataURL("image/png"));
  }

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg-primary">{label}</h3>
        <div className="flex w-fit gap-1 rounded-lg bg-surface-2 p-1">
          {(["draw", "type"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                if (t === "draw") clearCanvas();
                else renderTyped(typed || signerName);
                if (t === "type" && !typed) setTyped(signerName);
              }}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                tab === t ? "bg-gold-500 text-on-gold" : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {t === "draw" ? "Draw" : "Type"}
            </button>
          ))}
        </div>
      </div>

      {tab === "draw" ? (
        <div className="flex flex-col gap-2">
          <div className="relative overflow-hidden rounded-lg border border-line bg-white" style={{ touchAction: "none" }}>
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              aria-label="Draw your signature here"
              className="block w-full cursor-crosshair"
              style={{ height: H / 2, touchAction: "none" }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerLeave={up}
            />
            <div className="pointer-events-none absolute bottom-2 left-3 select-none text-xs text-gray-400">
              Sign here
            </div>
          </div>
          <button
            type="button"
            onClick={clearCanvas}
            className="self-end text-xs text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <input
            type="text"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              renderTyped(e.target.value);
            }}
            placeholder="Type your full name"
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-400 focus:outline-none"
          />
          <div className="flex min-h-[64px] items-center rounded-lg border border-line bg-white px-4 py-3">
            <span style={{ fontFamily: "'Dancing Script', Georgia, cursive", fontSize: "2rem", color: INK }}>
              {typed}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
