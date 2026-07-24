/* eslint-disable @next/next/no-img-element */
// FundExecs OS — 2.5D office world. Faithful port of the map prototype.
// Pure presentational component (no hooks) — renders a fixed 1560×980 stage.
import type { ReactNode } from "react";
import "./office.css";

const A = "/assets/office16";
const T = (n: string) => `${A}/tiles/${n}.png`;
const FN = (n: string) => `${A}/furniture/${n}.png`;
const LB = (n: string) => `${A}/littlebits/${n}.png`;
const TILE = 32;
const W = 1560;
const H = 980;
const GRADE = "linear-gradient(0deg,rgba(8,14,30,.40),rgba(8,14,30,.40))";

type Room = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floor: string;
  floorLB?: boolean;
};
type Item = { src: string; x: number; y: number; w: number; h: number; z: number };
type Panel = { cls: string; x: number; y: number; w: number; h: number; z: number; inner: ReactNode };
type Chart = { x: number; y: number; z: number; kind: string };

const ROOMS: Room[] = [
  { id: "ceo", label: "CEO OFFICE", x: 16, y: 16, w: 592, h: 372, floor: "parquet" },
  { id: "board", label: "BOARDROOM", x: 624, y: 30, w: 196, h: 358, floor: "stone-dark" },
  { id: "trade", label: "TRADING FLOOR", x: 836, y: 30, w: 322, h: 358, floor: "stone-dark" },
  { id: "rsrch", label: "RESEARCH HUB", x: 1174, y: 16, w: 370, h: 372, floor: "tile-teal" },
  { id: "legal", label: "LEGAL CORNER", x: 16, y: 404, w: 396, h: 250, floor: "wood-brown" },
  { id: "invst", label: "INVESTOR LOUNGE", x: 16, y: 670, w: 396, h: 294, floor: "stone-dark" },
  { id: "ops", label: "OPERATIONS HUB", x: 470, y: 420, w: 486, h: 250, floor: "green", floorLB: true },
  { id: "mktg", label: "MARKETING SALOON", x: 1016, y: 420, w: 528, h: 250, floor: "wood-brown" },
];

function buildScene() {
  const fu: Item[] = [];
  const panels: Panel[] = [];
  const charts: Chart[] = [];
  const add = (src: string, x: number, y: number, w: number, h: number, z?: number) =>
    fu.push({ src: FN(src), x, y, w, h, z: z == null ? y + h : z });
  const addLB = (src: string, x: number, y: number, w: number, h: number, z?: number) =>
    fu.push({ src: LB(src), x, y, w, h, z: z == null ? y + h : z });
  const P = (cls: string, x: number, y: number, w: number, h: number, z?: number, inner?: ReactNode) =>
    panels.push({ cls, x, y, w, h, z: z == null ? y + h : z, inner: inner ?? null });
  const chart = (x: number, y: number, z?: number, kind?: string) =>
    charts.push({ x, y, z: z == null ? y + 40 : z, kind: kind || "green" });
  const ws = (x: number, y: number, chair?: string, kind?: string) => {
    const b = y + 96;
    add((chair || "ChairGrey") + "Up", x + 16, y + 62, 32, 32, b - 1);
    add("TableBrown", x, y, 64, 96, b);
    add("ScreenBlackDown", x + 16, y + 8, 32, 32, b + 1);
    chart(x + 19, y + 11, b + 2, kind);
  };

  // ===== CEO OFFICE =====
  {
    const r = ROOMS[0], rx = r.x, ry = r.y;
    P("skyline", rx + 150, ry + 22, 300, 120, ry + 22);
    add("ChairGreyUp", rx + 250, ry + 150, 32, 32, ry + 180);
    add("TableDarkBrown", rx + 210, ry + 186, 96, 64, ry + 250);
    add("ScreenBlackUp", rx + 250, ry + 196, 32, 32, ry + 252);
    add("LaptopBlackDown", rx + 218, ry + 200, 32, 32, ry + 253);
    add("CouchBrownRight", rx + 70, ry + 250, 32, 64, ry + 314);
    add("CouchBrownLeft", rx + 430, ry + 250, 32, 64, ry + 314);
    add("MuralPlant", rx + 250, ry + 300, 32, 32, ry + 332);
    addLB("shelf", rx + 470, ry + 150, 32, 64, ry + 214);
    addLB("shelf", rx + 506, ry + 150, 32, 64, ry + 214);
    add("Plant", rx + 30, ry + 150, 96, 96, ry + 246);
    add("PlantSmall", rx + 490, ry + 250, 32, 64, ry + 314);
  }
  // ===== BOARDROOM =====
  {
    const r = ROOMS[1], rx = r.x, ry = r.y, cx = rx + r.w / 2;
    P("board-deal", rx + 24, ry + 40, 148, 92, ry + 40,
      <>
        <div className="bh">DEAL FLOW Q4</div>
        <ul><li>SOURCING</li><li>DUE DILIGENCE</li><li>NEGOTIATION</li><li>EXECUTION</li></ul>
        <div className="pie" />
      </>);
    const ty = ry + 170;
    add("TableDarkBrown", cx - 32, ty, 64, 140, ty + 140);
    add("ChairGreyUp", cx - 16, ty - 26, 32, 32, ty + 8);
    add("ChairGreyDown", cx - 16, ty + 140, 32, 32, ty + 174);
    add("ChairGreyLeft", cx - 58, ty + 24, 32, 32, ty + 56);
    add("ChairGreyLeft", cx - 58, ty + 82, 32, 32, ty + 114);
    add("ChairGreyRight", cx + 26, ty + 24, 32, 32, ty + 56);
    add("ChairGreyRight", cx + 26, ty + 82, 32, 32, ty + 114);
    add("PlantSmall", rx + 16, ry + 40, 32, 64, ry + 104);
    add("PlantSmall", rx + r.w - 48, ry + 40, 32, 64, ry + 104);
  }
  // ===== TRADING FLOOR =====
  {
    const r = ROOMS[2], rx = r.x, ry = r.y;
    P("ticker-panel", rx + 18, ry + 38, 286, 40, ry + 38,
      <>
        <span>AAPL <b className="up">187.45 ▲1.23%</b></span>
        <span>MSFT <b className="up">432.78 ▲0.87%</b></span>
        <br />
        <span>SPX <b className="up">5,251 ▲0.27%</b></span>
        <span>SPY <b className="up">525.14 ▲0.41%</b></span>
      </>);
    const dx = [rx + 40, rx + 180], dy = [ry + 110, ry + 240];
    dy.forEach((y) => dx.forEach((x) => {
      add("ChairGreyUp", x + 24, y + 70, 32, 32, y - 1 + 96);
      add("TableDarkBrown", x, y, 96, 64, y + 96);
      add("ScreenBlackUp", x + 6, y + 6, 32, 32, y + 97);
      add("ScreenBlackUp", x + 52, y + 6, 32, 32, y + 97);
      chart(x + 9, y + 9, y + 98, "blue");
      chart(x + 55, y + 9, y + 98, "green");
    }));
    add("PlantSmall", rx + 16, ry + 34, 32, 64, ry + 98);
  }
  // ===== RESEARCH HUB =====
  {
    const r = ROOMS[3], rx = r.x, ry = r.y;
    P("whiteboard", rx + 40, ry + 30, 270, 110, ry + 30,
      <>
        <div className="wbh">RESEARCH</div>
        <div className="wbcharts"><div className="ln" /><div className="br" /><div className="pi" /></div>
      </>);
    ([[rx + 40, ry + 170], [rx + 200, ry + 250]] as const).forEach(([x, y]) => {
      add("ChairGreyUp", x + 24, y + 66, 32, 32, y + 95);
      add("TableBrown", x, y, 64, 96, y + 96);
      add("TableNarrowBrown", x + 64, y + 32, 32, 64, y + 96);
      add("ScreenBlackDown", x + 16, y + 8, 32, 32, y + 97);
      chart(x + 19, y + 11, y + 98, "blue");
    });
    add("MuralPlant", rx + 300, ry + 40, 32, 32, ry + 72);
    addLB("filing-cabinet", rx + r.w - 64, ry + 150, 32, 64, ry + 214);
    add("Plant", rx + 20, ry + 270, 96, 96, ry + 366);
    add("PlantSmall", rx + r.w - 52, ry + 250, 32, 64, ry + 314);
  }
  // ===== LEGAL CORNER =====
  {
    const r = ROOMS[4], rx = r.x, ry = r.y;
    addLB("shelf", rx + 180, ry + 34, 32, 64, ry + 98);
    addLB("shelf", rx + 216, ry + 34, 32, 64, ry + 98);
    addLB("shelf", rx + 252, ry + 34, 32, 64, ry + 98);
    add("ChairGreyUp", rx + 70, ry + 120, 32, 32, ry + 150);
    add("TableDarkBrown", rx + 40, ry + 150, 96, 64, ry + 214);
    add("LaptopBlackDown", rx + 48, ry + 160, 32, 32, ry + 215);
    P("scales", rx + 150, ry + 150, 26, 30, ry + 215,
      <><div className="beam" /><div className="pan l" /><div className="pan r" /></>);
    addLB("filing-cabinet", rx + 300, ry + 150, 32, 64, ry + 214);
    addLB("filing-cabinet", rx + 336, ry + 150, 32, 64, ry + 214);
    P("certs", rx + 30, ry + 30, 120, 44, ry + 30, <><span /><span /><span /></>);
  }
  // ===== INVESTOR LOUNGE =====
  {
    const r = ROOMS[5], rx = r.x, ry = r.y;
    addLB("shelf", rx + 40, ry + 34, 32, 64, ry + 98);
    addLB("shelf", rx + 76, ry + 34, 32, 64, ry + 98);
    P("artframe", rx + 150, ry + 40, 80, 52, ry + 40, <div className="scene" />);
    add("CouchBlueUp", rx + 60, ry + 150, 64, 32, ry + 182);
    add("CouchBlueUp", rx + 130, ry + 150, 64, 32, ry + 182);
    add("CouchBlueRight", rx + 40, ry + 186, 32, 64, ry + 250);
    add("CoffeeDispenser", rx + 120, ry + 210, 32, 32, ry + 242);
    addLB("coffee-table", rx + 150, ry + 205, 64, 56, ry + 261);
    add("Plant", rx + 300, ry + 150, 96, 96, ry + 246);
    add("PlantSmall", rx + 300, ry + 40, 32, 64, ry + 104);
  }
  // ===== OPERATIONS HUB =====
  {
    const r = ROOMS[6], rx = r.x, ry = r.y;
    P("kanban", rx + 30, ry + 34, 250, 96, ry + 34,
      <>
        <div className="kh">WORKFLOW</div>
        <div className="cols">
          <div className="col"><b>TO DO</b><i /><i /></div>
          <div className="col"><b>IN PROGRESS</b><i /><i /><i /></div>
          <div className="col"><b>DONE</b><i /></div>
        </div>
      </>);
    P("status", rx + 300, ry + 34, 150, 96, ry + 34,
      <>
        <div className="sh">SYSTEM STATUS</div>
        <ul><li>SERVERS ONLINE</li><li>DATA SYNC OK</li><li>BACKUPS OK</li></ul>
      </>);
    [rx + 60, rx + 160, rx + 260].forEach((x) => {
      const y = ry + 150;
      add("ChairGreyDown", x + 16, y + 70, 32, 32, y + 104);
      add("TableSmallGrey", x, y, 32, 64, y + 64);
      add("ScreenBlackDown", x, y + 2, 32, 32, y + 65);
      chart(x + 3, y + 5, y + 66, "blue");
    });
    P("server", rx + 400, ry + 140, 40, 90, ry + 230, <><i /><i /><i /><i /><i /></>);
    add("PlantSmall", rx + r.w - 52, ry + 150, 32, 64, ry + 214);
    add("PlantSmall", rx + r.w - 52, ry + 40, 32, 64, ry + 104);
  }
  // ===== MARKETING SALOON =====
  {
    const r = ROOMS[7], rx = r.x, ry = r.y;
    P("neon", rx + r.w - 140, ry + 36, 104, 66, ry + 36, <>BRAND<br />VIBES</>);
    P("campaign", rx + 30, ry + 40, 90, 60, ry + 40, <div className="ch">CAMPAIGN<br />PLAN</div>);
    P("artgrid", rx + 140, ry + 38, 220, 70, ry + 38, <><i /><i /><i /><i /><i /><i /><i /><i /></>);
    addLB("counter", rx + 120, ry + 150, 128, 64, ry + 214);
    add("ChairGreyUp", rx + 150, ry + 220, 32, 32, ry + 252);
    add("ChairGreyUp", rx + 210, ry + 220, 32, 32, ry + 252);
    add("CouchBlueDown", rx + r.w - 110, ry + 186, 64, 32, ry + 220);
    add("Plant", rx + 20, ry + 150, 96, 96, ry + 246);
    add("PlantSmall", rx + r.w - 52, ry + 150, 32, 64, ry + 214);
  }
  // ===== RECEPTION =====
  const RCX = 700, RCY = 712;
  P("recsign", RCX - 92, RCY - 46, 220, 40, 9997, <><div className="rbar" /><span>FundExecs OS</span></>);
  P("recdesk", RCX - 96, RCY, 232, 66, RCY + 66);
  add("ScreenBlackDown", RCX - 16, RCY + 8, 32, 32, RCY + 70);
  add("Plant", RCX - 190, RCY + 6, 96, 96, RCY + 102);
  add("Plant", RCX + 150, RCY + 6, 96, 96, RCY + 102);
  add("PlantSmall", RCX + 50, RCY + 18, 32, 64, RCY + 82);
  // ===== WELCOME =====
  P("welcome", W / 2 - 90, H - 58, 180, 30, 9998, "WELCOME");
  P("gdoor", W / 2 - 70, H - 140, 140, 78, 9990, <><div className="gl" /><div className="gm" /></>);
  P("stanch", W / 2 - 150, H - 130, 18, 58, 9990);
  P("stanch", W / 2 + 132, H - 130, 18, 58, 9990);
  P("rope", W / 2 - 132, H - 114, 80, 6, 9990);
  P("rope", W / 2 + 52, H - 114, 80, 6, 9990);
  ([[470, 760], [980, 760], [1120, 820], [560, 880], [900, 880]] as const).forEach(([x, y], i) =>
    i % 2 ? add("PlantSmall", x, y, 32, 64, y + 64) : add("Plant", x, y, 96, 96, y + 96));
  // CEO plaque
  P("plq", 536, 46, 0, 0, 46, <>DEAL<br />CLOSED</>);

  fu.sort((a, b) => a.z - b.z);
  return { fu, panels, charts };
}

function bracketDivs(r: Room) {
  const corners = ["tl", "tr", "bl", "br"] as const;
  return corners.map((c) => (
    <div
      key={c}
      className={`brk ${c}`}
      style={{ left: c[1] === "l" ? r.x - 2 : r.x + r.w - 16, top: c[0] === "t" ? r.y - 2 : r.y + r.h - 16 }}
    />
  ));
}

export default function OfficeMap() {
  const { fu, panels, charts } = buildScene();
  return (
    <div className="fxo">
      <div className="stage-scroll">
        <div className="wrap">
          <div
            className="floor"
            style={{ background: `${GRADE},url(${T("floor-cream")})`, backgroundSize: `auto,${TILE}px` }}
          />
          {ROOMS.map((r) => {
            const fl = r.floorLB ? LB("floor-" + r.floor) : T(r.floor);
            const sz = r.floorLB ? "32px" : TILE + "px";
            return (
              <div key={r.id}>
                <div
                  className="rf"
                  style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: `${GRADE},url(${fl})`, backgroundSize: `auto,${sz}` }}
                />
                <div className="rw" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
                {bracketDivs(r)}
                <span className="rl" style={{ left: r.x + r.w / 2, top: r.y - 11 }}>
                  {r.label}
                </span>
              </div>
            );
          })}
          {panels.map((p, i) => (
            <div
              key={i}
              className={`pnl ${p.cls}`}
              style={{ left: p.x, top: p.y, width: p.w || undefined, height: p.h || undefined, zIndex: p.z }}
            >
              {p.inner}
            </div>
          ))}
          {fu.map((f, i) => (
            <img
              key={i}
              className="f"
              src={f.src}
              alt=""
              style={{ left: f.x, top: f.y, width: f.w, height: f.h, zIndex: f.z }}
            />
          ))}
          {charts.map((c, i) => (
            <div key={i} className={`chart ${c.kind}`} style={{ left: c.x, top: c.y, zIndex: c.z }} />
          ))}
          <div className="lightpool" />
          <div className="vig" />
        </div>
      </div>
    </div>
  );
}
