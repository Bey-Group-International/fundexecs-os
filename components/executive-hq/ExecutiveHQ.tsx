"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExecutiveHQBoot } from "./ExecutiveHQBoot";

type Executive = {
  id: string;
  name: string;
  role: string;
  card: string;
  themeColor: string;
  bobDelay?: string;
};

type Room = {
  id: string;
  label: string;
  sublabel: string;
  href: string;
  bgColor: string;
  borderColor: string;
  glowColor: string;
  accentLight: string;
  executives: Executive[];
  gridArea: string;
};

const EXECUTIVES: Record<string, Executive> = {
  earnest: {
    id: "earnest-fundmaker",
    name: "Earnest Fundmaker",
    role: "Fund Executive",
    card: "/assets/fundexecs/characters/earnest-fundmaker/card.png",
    themeColor: "#fbbf24",
    bobDelay: "0s",
  },
  capitalConnector: {
    id: "capital-connector",
    name: "Capital Connector",
    role: "Chief Capital Officer",
    card: "/assets/fundexecs/characters/capital-connector/card.png",
    themeColor: "#14b8a6",
    bobDelay: "0.4s",
  },
  dealSourcer: {
    id: "deal-sourcer",
    name: "Deal Sourcer",
    role: "Acquisition Executive",
    card: "/assets/fundexecs/characters/deal-sourcer/card.png",
    themeColor: "#f97316",
    bobDelay: "0.2s",
  },
  executiveAdvisor: {
    id: "executive-advisor",
    name: "Executive Advisor",
    role: "Investor Intelligence",
    card: "/assets/fundexecs/characters/executive-advisor/card.png",
    themeColor: "#a855f7",
    bobDelay: "0.6s",
  },
  capitalRaiser: {
    id: "capital-raiser",
    name: "Capital Raiser",
    role: "Capital Raising Executive",
    card: "/assets/fundexecs/characters/capital-raiser/card.png",
    themeColor: "#eab308",
    bobDelay: "0.8s",
  },
  investorRelations: {
    id: "investor-relations",
    name: "Investor Relations",
    role: "IR Executive",
    card: "/assets/fundexecs/characters/investor-relations/card.png",
    themeColor: "#f59e0b",
    bobDelay: "0.3s",
  },
  automater: {
    id: "automater",
    name: "Automater",
    role: "Automation Executive",
    card: "/assets/fundexecs/characters/automater/card.png",
    themeColor: "#22c55e",
    bobDelay: "0.5s",
  },
  workflowInstructor: {
    id: "workflow-instructor",
    name: "Workflow Instructor",
    role: "Training Executive",
    card: "/assets/fundexecs/characters/workflow-instructor/card.png",
    themeColor: "#ef4444",
    bobDelay: "0.7s",
  },
  prDirector: {
    id: "pr-director",
    name: "PR Director",
    role: "Brand & PR Executive",
    card: "/assets/fundexecs/characters/pr-director/card.png",
    themeColor: "#ec4899",
    bobDelay: "0.1s",
  },
  leadGenerator: {
    id: "lead-generator",
    name: "Lead Generator",
    role: "Growth Executive",
    card: "/assets/fundexecs/characters/lead-generator/card.png",
    themeColor: "#84cc16",
    bobDelay: "0.9s",
  },
  seoDisruptor: {
    id: "seo-disruptor",
    name: "SEO Disruptor",
    role: "SEO Executive",
    card: "/assets/fundexecs/characters/seo-disruptor/card.png",
    themeColor: "#8b5cf6",
    bobDelay: "0.35s",
  },
  curator: {
    id: "curator",
    name: "Curator",
    role: "Private Events Executive",
    card: "/assets/fundexecs/characters/curator/card.png",
    themeColor: "#d946ef",
    bobDelay: "0.65s",
  },
  rainmaker: {
    id: "rainmaker",
    name: "Rainmaker",
    role: "Revenue Executive",
    card: "/assets/fundexecs/characters/rainmaker/card.png",
    themeColor: "#fbbf24",
    bobDelay: "0.45s",
  },
};

const ROOMS: Room[] = [
  {
    id: "ceo-office",
    label: "CEO OFFICE",
    sublabel: "Command Center",
    href: "/dashboard",
    bgColor: "#0f0a04",
    borderColor: "#b45309",
    glowColor: "rgba(180,83,9,0.6)",
    accentLight: "rgba(251,191,36,0.12)",
    executives: [EXECUTIVES.earnest],
    gridArea: "ceo",
  },
  {
    id: "boardroom",
    label: "BOARDROOM",
    sublabel: "Strategy & Intelligence",
    href: "/build",
    bgColor: "#04080f",
    borderColor: "#1e40af",
    glowColor: "rgba(30,64,175,0.6)",
    accentLight: "rgba(59,130,246,0.10)",
    executives: [EXECUTIVES.executiveAdvisor],
    gridArea: "board",
  },
  {
    id: "trading-floor",
    label: "TRADING FLOOR",
    sublabel: "Deal Flow & Acquisitions",
    href: "/run",
    bgColor: "#060a0a",
    borderColor: "#0f766e",
    glowColor: "rgba(15,118,110,0.6)",
    accentLight: "rgba(20,184,166,0.10)",
    executives: [EXECUTIVES.dealSourcer, EXECUTIVES.capitalRaiser],
    gridArea: "trading",
  },
  {
    id: "research-hub",
    label: "RESEARCH HUB",
    sublabel: "Diligence & Analysis",
    href: "/source",
    bgColor: "#04090f",
    borderColor: "#155e75",
    glowColor: "rgba(21,94,117,0.6)",
    accentLight: "rgba(6,182,212,0.10)",
    executives: [EXECUTIVES.workflowInstructor],
    gridArea: "research",
  },
  {
    id: "investor-lounge",
    label: "INVESTOR LOUNGE",
    sublabel: "Capital & LP Relations",
    href: "/dashboard/capital",
    bgColor: "#080410",
    borderColor: "#6b21a8",
    glowColor: "rgba(107,33,168,0.6)",
    accentLight: "rgba(168,85,247,0.10)",
    executives: [EXECUTIVES.capitalConnector, EXECUTIVES.investorRelations],
    gridArea: "investor",
  },
  {
    id: "operations-hub",
    label: "OPERATIONS HUB",
    sublabel: "Workflow & Automation",
    href: "/command-center",
    bgColor: "#040c06",
    borderColor: "#166534",
    glowColor: "rgba(22,101,52,0.6)",
    accentLight: "rgba(34,197,94,0.10)",
    executives: [EXECUTIVES.automater],
    gridArea: "ops",
  },
  {
    id: "legal-corner",
    label: "LEGAL CORNER",
    sublabel: "Compliance & Reporting",
    href: "/settings",
    bgColor: "#0c0404",
    borderColor: "#991b1b",
    glowColor: "rgba(153,27,27,0.6)",
    accentLight: "rgba(239,68,68,0.10)",
    executives: [EXECUTIVES.rainmaker],
    gridArea: "legal",
  },
  {
    id: "marketing-saloon",
    label: "MARKETING SALOON",
    sublabel: "Brand, Growth & SEO",
    href: "/dashboard/marketing",
    bgColor: "#0c0803",
    borderColor: "#92400e",
    glowColor: "rgba(146,64,14,0.6)",
    accentLight: "rgba(245,158,11,0.10)",
    executives: [EXECUTIVES.prDirector, EXECUTIVES.leadGenerator, EXECUTIVES.seoDisruptor, EXECUTIVES.curator],
    gridArea: "marketing",
  },
];

function ExecAvatar({
  exec,
  size = "md",
  onSelect,
}: {
  exec: Executive;
  size?: "sm" | "md";
  onSelect: (exec: Executive) => void;
}) {
  const px = size === "sm" ? 44 : 56;
  return (
    <button
      type="button"
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onSelect(exec);
      }}
      className="group/exec relative flex flex-col items-center gap-0.5 focus:outline-none"
      style={{ animationDelay: exec.bobDelay }}
      title={`${exec.name} — ${exec.role}`}
    >
      <span
        className="exec-bob block overflow-hidden rounded-sm border transition-all duration-200 group-hover/exec:scale-110"
        style={{
          width: px,
          height: px,
          borderColor: exec.themeColor + "60",
          boxShadow: `0 0 10px ${exec.themeColor}30`,
          animationDelay: exec.bobDelay,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={exec.card}
          alt={exec.name}
          width={px}
          height={px}
          className="h-full w-full object-cover"
          style={{ imageRendering: "pixelated" }}
          draggable={false}
        />
      </span>
      <span
        className="max-w-[60px] truncate text-center font-mono text-[8px] leading-tight opacity-60 transition-opacity group-hover/exec:opacity-100"
        style={{ color: exec.themeColor }}
      >
        {exec.name.split(" ")[0]}
      </span>
    </button>
  );
}

function RoomPanel({
  room,
  onExecSelect,
}: {
  room: Room;
  onExecSelect: (exec: Executive) => void;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      className="room-panel group relative flex w-full cursor-pointer flex-col overflow-hidden rounded-none text-left focus:outline-none"
      style={{
        background: room.bgColor,
        border: `2px solid ${hovered ? room.borderColor : room.borderColor + "80"}`,
        boxShadow: hovered
          ? `0 0 24px ${room.glowColor}, inset 0 0 40px ${room.accentLight}`
          : `inset 0 0 20px ${room.accentLight}`,
        transition: "all 0.2s ease",
        gridArea: room.gridArea,
        minHeight: 160,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => router.push(room.href)}
    >
      {/* Room label bar */}
      <div
        className="flex items-center justify-between px-2 py-1"
        style={{
          background: `linear-gradient(90deg, ${room.borderColor}30, transparent)`,
          borderBottom: `1px solid ${room.borderColor}40`,
        }}
      >
        <span
          className="font-mono text-[9px] font-bold uppercase tracking-widest"
          style={{ color: room.borderColor, textShadow: `0 0 8px ${room.borderColor}` }}
        >
          {room.label}
        </span>
        <span className="font-mono text-[7px] uppercase tracking-wider text-white/20">
          {hovered ? "→ ENTER" : ""}
        </span>
      </div>

      {/* Executives */}
      <div className="flex flex-1 flex-wrap items-end justify-center gap-2 p-2 pb-3">
        {room.executives.map((exec) => (
          <ExecAvatar
            key={exec.id}
            exec={exec}
            size={room.executives.length > 2 ? "sm" : "md"}
            onSelect={onExecSelect}
          />
        ))}
      </div>

      {/* Hover sublabel */}
      <div
        className="absolute bottom-1 left-0 right-0 text-center font-mono text-[8px] uppercase tracking-wider transition-opacity duration-200"
        style={{
          color: room.borderColor,
          opacity: hovered ? 0.7 : 0,
        }}
      >
        {room.sublabel}
      </div>
    </button>
  );
}

type SelectedExec = Executive | null;

export function ExecutiveHQ() {
  const [selected, setSelected] = useState<SelectedExec>(null);
  const [booting, setBooting] = useState(true);

  if (booting) {
    return <ExecutiveHQBoot onComplete={() => setBooting(false)} />;
  }

  return (
    <div
      className="relative flex min-h-[600px] w-full flex-col select-none"
      style={{ background: "#030508", fontFamily: "var(--font-mono, monospace)" }}
    >
      <style>{`
        @keyframes exec-bob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-3px); }
        }
        .exec-bob {
          animation: exec-bob 2.8s ease-in-out infinite;
        }
      `}</style>

      {/* Executive details panel */}
      {selected && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative flex max-w-xs flex-col items-center gap-3 rounded-xl border p-6 text-center shadow-2xl"
            style={{
              background: "#0a0f1a",
              borderColor: selected.themeColor + "60",
              boxShadow: `0 0 40px ${selected.themeColor}30`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className="font-mono text-[9px] uppercase tracking-widest"
              style={{ color: selected.themeColor }}
            >
              AI Executive
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selected.card}
              alt={selected.name}
              width={96}
              height={96}
              className="rounded-sm border"
              style={{
                imageRendering: "pixelated",
                borderColor: selected.themeColor + "50",
                boxShadow: `0 0 16px ${selected.themeColor}40`,
              }}
              draggable={false}
            />
            <div>
              <p className="font-display text-lg font-semibold text-white">{selected.name}</p>
              <p className="mt-0.5 font-mono text-xs text-white/50">{selected.role}</p>
            </div>
            <div className="flex gap-2">
              <Link
                href={`/dashboard?agent=${selected.id}`}
                className="rounded-lg border px-3 py-1.5 font-mono text-xs transition hover:opacity-90"
                style={{
                  borderColor: selected.themeColor + "60",
                  color: selected.themeColor,
                  background: selected.themeColor + "15",
                }}
                onClick={() => setSelected(null)}
              >
                Open Copilot
              </Link>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg border border-white/10 px-3 py-1.5 font-mono text-xs text-white/40 transition hover:border-white/20 hover:text-white/60"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Office grid */}
      <div
        className="flex-1 p-3 sm:p-4"
        style={{
          display: "grid",
          gridTemplateAreas: `
            "ceo    board   trading  research"
            "investor ops    legal    marketing"
            ".       reception reception ."
          `,
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gridTemplateRows: "1fr 1fr auto",
          gap: "6px",
        }}
      >
        {ROOMS.map((room) => (
          <RoomPanel key={room.id} room={room} onExecSelect={setSelected} />
        ))}

        {/* Reception */}
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-none border py-4"
          style={{
            gridArea: "reception",
            background: "#050810",
            borderColor: "#b4932060",
            boxShadow: "inset 0 0 30px rgba(180,147,32,0.08)",
          }}
        >
          <div className="flex items-center gap-2">
            {/* Earnest mini at reception */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/assets/fundexecs/characters/earnest-fundmaker/card.png"
              alt="Earnest Fundmaker"
              width={36}
              height={36}
              className="exec-bob rounded-sm border border-yellow-500/30"
              style={{ imageRendering: "pixelated", animationDelay: "1.2s" }}
              draggable={false}
            />
            <div className="text-center">
              <div className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full bg-yellow-400"
                  style={{ boxShadow: "0 0 6px #fbbf24" }}
                />
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-yellow-400/80">
                  FundExecs
                </span>
              </div>
              <span className="font-mono text-[8px] uppercase tracking-[0.2em] text-white/30">
                RECEPTION · AFTER HOURS
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Footer brand bar */}
      <div
        className="flex items-center justify-center gap-2 border-t px-4 py-2"
        style={{ borderColor: "#b4932025", background: "#020406" }}
      >
        <span
          className="font-mono text-[9px] uppercase tracking-[0.4em]"
          style={{ color: "#b49320", textShadow: "0 0 12px rgba(180,147,32,0.4)" }}
        >
          ✦ FundExecs OS ✦
        </span>
        <span className="font-mono text-[8px] text-white/15">Private Markets Operating System</span>
      </div>
    </div>
  );
}
