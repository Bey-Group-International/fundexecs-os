"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import type { SigningData } from "./page";

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "draw" | "type";

interface CaptureState {
  tab: Tab;
  dataUrl: string | null;
  typedText: string;
}

const emptyCaptureState = (): CaptureState => ({
  tab: "draw",
  dataUrl: null,
  typedText: "",
});

// ─── Draw Canvas ──────────────────────────────────────────────────────────────

interface DrawCanvasProps {
  width: number;
  height: number;
  strokeColor?: string;
  strokeWidth?: number;
  onDrawEnd: (dataUrl: string) => void;
  onClear: () => void;
}

function DrawCanvas({
  width,
  height,
  strokeColor = "#C9A227",
  strokeWidth = 2.5,
  onDrawEnd,
  onClear,
}: DrawCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const hasDrawn = useRef(false);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    isDrawing.current = true;
    lastPos.current = getPos(e);
    hasDrawn.current = true;

    // Draw a dot for taps/clicks
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      const pos = getPos(e);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, strokeWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = strokeColor;
      ctx.fill();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing.current || !lastPos.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    lastPos.current = pos;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    isDrawing.current = false;
    lastPos.current = null;
    if (hasDrawn.current && canvasRef.current) {
      onDrawEnd(canvasRef.current.toDataURL("image/png"));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    hasDrawn.current = false;
    onClear();
  };

  return (
    <div className="flex flex-col gap-2">
      <div
        className="relative rounded-lg border border-white/15 bg-white/5 overflow-hidden"
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="block w-full cursor-crosshair"
          style={{ height: height / 2, touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
        <div className="absolute bottom-2 left-3 text-xs text-slate-600 pointer-events-none select-none">
          Draw your signature
        </div>
      </div>
      <button
        type="button"
        onClick={clear}
        className="self-end text-xs text-slate-400 hover:text-white underline underline-offset-2 transition-colors"
      >
        Clear
      </button>
    </div>
  );
}

// ─── Signature Capture Panel ──────────────────────────────────────────────────

interface CapturePanelProps {
  label: string;
  isInitials?: boolean;
  signerName: string;
  state: CaptureState;
  onChange: (s: CaptureState) => void;
}

function CapturePanel({
  label,
  isInitials = false,
  signerName,
  state,
  onChange,
}: CapturePanelProps) {
  const canvasWidth = isInitials ? 400 : 800;
  const canvasHeight = isInitials ? 160 : 240;

  const previewText = isInitials
    ? signerName
        .split(" ")
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : state.typedText || signerName;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <h3 className="text-sm font-semibold text-white mb-3">{label}</h3>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-white/5 rounded-lg p-1 w-fit">
        {(["draw", "type"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onChange({ ...state, tab: t })}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              state.tab === t
                ? "bg-[#C9A227] text-[#0A0800] shadow"
                : "text-slate-400 hover:text-white"
            }`}
          >
            {t === "draw" ? "Draw" : "Type"}
          </button>
        ))}
      </div>

      {state.tab === "draw" && (
        <DrawCanvas
          width={canvasWidth}
          height={canvasHeight}
          strokeWidth={isInitials ? 2 : 2.5}
          onDrawEnd={(dataUrl) => onChange({ ...state, dataUrl })}
          onClear={() => onChange({ ...state, dataUrl: null })}
        />
      )}

      {state.tab === "type" && (
        <div className="flex flex-col gap-3">
          <input
            type="text"
            placeholder={isInitials ? "Your initials" : "Type your full name"}
            value={isInitials ? state.typedText || previewText : state.typedText}
            onChange={(e) => {
              const val = e.target.value;
              onChange({
                ...state,
                typedText: val,
                dataUrl: val.trim() ? "__typed__" : null,
              });
            }}
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-[#C9A227]/60 focus:ring-1 focus:ring-[#C9A227]/30 transition"
          />
          {/* Preview */}
          {(state.typedText || isInitials) && (
            <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 min-h-[56px] flex items-center">
              <span
                className="text-2xl text-[#C9A227]"
                style={{
                  fontFamily: "'Dancing Script', Georgia, cursive",
                  fontSize: isInitials ? "2rem" : "1.75rem",
                }}
              >
                {state.typedText || (isInitials ? previewText : signerName)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  data: SigningData;
  token: string;
}

export default function SigningExperience({ data, token }: Props) {
  const [agreed, setAgreed] = useState(false);
  const [signature, setSignature] = useState<CaptureState>(emptyCaptureState());
  const [initials, setInitials] = useState<CaptureState>(emptyCaptureState());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedAt, setCompletedAt] = useState<string | null>(null);

  // Load Dancing Script from Google Fonts
  useEffect(() => {
    const link = document.createElement("link");
    link.href =
      "https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  const signatureReady = Boolean(signature.dataUrl);
  const initialsReady = Boolean(initials.dataUrl);
  const canComplete = agreed && signatureReady && initialsReady;

  // Convert typed text to a base64 PNG via an offscreen canvas
  const resolveDataUrl = useCallback(
    async (state: CaptureState, isInitials: boolean): Promise<string> => {
      if (state.dataUrl && state.dataUrl !== "__typed__") return state.dataUrl;

      const text =
        state.typedText ||
        (isInitials
          ? data.recipientName
              .split(" ")
              .map((w: string) => w[0])
              .join("")
              .toUpperCase()
          : data.recipientName);

      const w = isInitials ? 200 : 400;
      const h = isInitials ? 80 : 120;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#C9A227";
      ctx.font = `${isInitials ? 42 : 36}px 'Dancing Script', Georgia, cursive`;
      ctx.textBaseline = "middle";
      ctx.fillText(text, 12, h / 2);
      return canvas.toDataURL("image/png");
    },
    [data.recipientName]
  );

  const handleComplete = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const [sigDataUrl, initDataUrl] = await Promise.all([
        resolveDataUrl(signature, false),
        resolveDataUrl(initials, true),
      ]);

      const res = await fetch(`/api/sign/${token}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signatureData: sigDataUrl,
          initialsData: initDataUrl,
          fieldResponses: {},
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error || `Server error ${res.status}`
        );
      }

      setCompletedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success screen ─────────────────────────────────────────────────────────

  if (completedAt) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl"
          style={{ background: "linear-gradient(135deg, #C9A227, #F0C040)" }}
        >
          ✓
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">
          Document Signed Successfully
        </h2>
        <p className="text-slate-400 mb-1">{data.documentTitle}</p>
        <p className="text-slate-500 text-sm">
          Signed by{" "}
          <span className="text-slate-300">{data.recipientName}</span> on{" "}
          {new Date(completedAt).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
          })}
        </p>
        <div className="mt-6 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs text-slate-500 font-mono">
          Token: {token}
        </div>
      </div>
    );
  }

  // ── Main signing UI ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* Agreement banner */}
      <div
        className={`rounded-xl border px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 transition-all ${
          agreed
            ? "border-[#C9A227]/40 bg-[#C9A227]/5"
            : "border-white/10 bg-white/[0.03]"
        }`}
      >
        <div className="flex-1 text-sm text-slate-300">
          <span className="font-medium text-white">Legal Notice: </span>
          By clicking &ldquo;I Agree&rdquo;, you consent to sign this document
          electronically and agree that your electronic signature is legally
          binding.
        </div>
        {!agreed ? (
          <button
            type="button"
            onClick={() => setAgreed(true)}
            className="shrink-0 px-5 py-2 rounded-lg text-sm font-semibold text-[#0A0800] transition-all hover:brightness-110 active:scale-95"
            style={{
              background: "linear-gradient(135deg, #C9A227, #F0C040)",
            }}
          >
            I Agree
          </button>
        ) : (
          <span className="shrink-0 flex items-center gap-1.5 text-[#C9A227] text-sm font-medium">
            <span className="text-base">✓</span> Agreed
          </span>
        )}
      </div>

      {/* Document card */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
        {/* Document header */}
        <div className="border-b border-white/10 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-white">
              {data.documentTitle}
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">
              You are signing as:{" "}
              <span className="text-white font-medium">
                {data.recipientName}
              </span>{" "}
              <span className="text-slate-600">({data.recipientEmail})</span>
            </p>
          </div>
          <div className="text-xs font-mono text-slate-600 border border-white/10 rounded px-2 py-1">
            {data.envelopeId?.slice(0, 8)}…
          </div>
        </div>

        {/* Document content */}
        <div className="p-5">
          <div
            className="rounded-lg border border-white/10 bg-black/20 p-4 text-sm text-slate-300 leading-relaxed max-h-72 overflow-y-auto"
            style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}
          >
            {data.documentContent}
          </div>
        </div>
      </div>

      {/* Signature + Initials capture — only after agreement */}
      {agreed && (
        <div className="flex flex-col gap-4">
          <CapturePanel
            label="Signature"
            signerName={data.recipientName}
            state={signature}
            onChange={setSignature}
          />
          <CapturePanel
            label="Initials"
            isInitials
            signerName={data.recipientName}
            state={initials}
            onChange={setInitials}
          />

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Complete button */}
          <button
            type="button"
            onClick={handleComplete}
            disabled={!canComplete || submitting}
            className="w-full py-3.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
            style={
              canComplete && !submitting
                ? {
                    background: "linear-gradient(135deg, #C9A227, #F0C040)",
                    color: "#0A0800",
                  }
                : {
                    background: "rgba(255,255,255,0.06)",
                    color: "#6b7280",
                  }
            }
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
                Submitting…
              </span>
            ) : !agreed ? (
              "Agree to enable signing"
            ) : !signatureReady || !initialsReady ? (
              `Add ${!signatureReady ? "signature" : "initials"} to continue`
            ) : (
              "Complete Signing"
            )}
          </button>

          <p className="text-center text-xs text-slate-600">
            Your signature will be recorded with a timestamp and IP address for
            legal validity.
          </p>
        </div>
      )}
    </div>
  );
}
