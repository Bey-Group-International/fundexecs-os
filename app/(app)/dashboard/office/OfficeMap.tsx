/* eslint-disable @next/next/no-img-element */
// FundExecs OS — 2.5D office world. Faithful port of the map prototype.
// Pure presentational component (no hooks) — renders a fixed 1560×980 stage.

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
type Panel = { cls: string; x: number; y: number; w: number; h: number; z: number; inner: string };
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
  const P = (cls: string, x: number, y: number, w: number, h: number, z?: number, inner?: string) =>
    panels.push({ cls, x, y, w, h, z: z == null ? y + h : z, inner: inner || "" });
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
      `<div class="bh">DEAL FLOW Q4</div><ul><li>SOURCING</li><li>DUE DILIGENCE</li><li>NEGOTIATION</li><li>EXECUTION</li></ul><div class="pie"></div>`);
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
      `<span>AAPL <b class="up">187.45 ▲1.23%</b></span><span>MSFT <b class="up">432.78 ▲0.87%</b></span><br><span>SPX <b class="up">5,251 ▲0.27%</b></span><span>SPY <b class="up">525.14 ▲0.41%</b></span>`);
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
      `<div class="wbh">RESEARCH</div><div class="wbcharts"><div class="ln"></div><div class="br"></div><div class="pi"></div></div>`);
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
    P("scales", rx + 150, ry + 150, 26, 30, ry + 215, '<div class="beam"></div><div class="pan l"></div><div class="pan r"></div>');
    addLB("filing-cabinet", rx + 300, ry + 150, 32, 64, ry + 214);
    addLB("filing-cabinet", rx + 336, ry + 150, 32, 64, ry + 214);
    P("certs", rx + 30, ry + 30, 120, 44, ry + 30, "<span></span><span></span><span></span>");
  }
  // ===== INVESTOR LOUNGE =====
  {
    const r = ROOMS[5], rx = r.x, ry = r.y;
    addLB("shelf", rx + 40, ry + 34, 32, 64, ry + 98);
    addLB("shelf", rx + 76, ry + 34, 32, 64, ry + 98);
    P("artframe", rx + 150, ry + 40, 80, 52, ry + 40, '<div class="scene"></div>');
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
      `<div class="kh">WORKFLOW</div><div class="cols"><div class="col"><b>TO DO</b><i></i><i></i></div><div class="col"><b>IN PROGRESS</b><i></i><i></i><i></i></div><div class="col"><b>DONE</b><i></i></div></div>`);
    P("status", rx + 300, ry + 34, 150, 96, ry + 34,
      `<div class="sh">SYSTEM STATUS</div><ul><li>SERVERS ONLINE</li><li>DATA SYNC OK</li><li>BACKUPS OK</li></ul>`);
    [rx + 60, rx + 160, rx + 260].forEach((x) => {
      const y = ry + 150;
      add("ChairGreyDown", x + 16, y + 70, 32, 32, y + 104);
      add("TableSmallGrey", x, y, 32, 64, y + 64);
      add("ScreenBlackDown", x, y + 2, 32, 32, y + 65);
      chart(x + 3, y + 5, y + 66, "blue");
    });
    P("server", rx + 400, ry + 140, 40, 90, ry + 230, "<i></i><i></i><i></i><i></i><i></i>");
    add("PlantSmall", rx + r.w - 52, ry + 150, 32, 64, ry + 214);
    add("PlantSmall", rx + r.w - 52, ry + 40, 32, 64, ry + 104);
  }
  // ===== MARKETING SALOON =====
  {
    const r = ROOMS[7], rx = r.x, ry = r.y;
    P("neon", rx + r.w - 140, ry + 36, 104, 66, ry + 36, "BRAND<br>VIBES");
    P("campaign", rx + 30, ry + 40, 90, 60, ry + 40, '<div class="ch">CAMPAIGN<br>PLAN</div>');
    P("artgrid", rx + 140, ry + 38, 220, 70, ry + 38, "<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>");
    addLB("counter", rx + 120, ry + 150, 128, 64, ry + 214);
    add("ChairGreyUp", rx + 150, ry + 220, 32, 32, ry + 252);
    add("ChairGreyUp", rx + 210, ry + 220, 32, 32, ry + 252);
    add("CouchBlueDown", rx + r.w - 110, ry + 186, 64, 32, ry + 220);
    add("Plant", rx + 20, ry + 150, 96, 96, ry + 246);
    add("PlantSmall", rx + r.w - 52, ry + 150, 32, 64, ry + 214);
  }
  // ===== RECEPTION =====
  const RCX = 700, RCY = 712;
  P("recsign", RCX - 92, RCY - 46, 220, 40, 9997, '<div class="rbar"></div><span>FundExecs OS</span>');
  P("recdesk", RCX - 96, RCY, 232, 66, RCY + 66, "");
  add("ScreenBlackDown", RCX - 16, RCY + 8, 32, 32, RCY + 70);
  add("Plant", RCX - 190, RCY + 6, 96, 96, RCY + 102);
  add("Plant", RCX + 150, RCY + 6, 96, 96, RCY + 102);
  add("PlantSmall", RCX + 50, RCY + 18, 32, 64, RCY + 82);
  // ===== WELCOME =====
  P("welcome", W / 2 - 90, H - 58, 180, 30, 9998, "WELCOME");
  P("gdoor", W / 2 - 70, H - 140, 140, 78, 9990, '<div class="gl"></div><div class="gm"></div>');
  P("stanch", W / 2 - 150, H - 130, 18, 58, 9990, "");
  P("stanch", W / 2 + 132, H - 130, 18, 58, 9990, "");
  P("rope", W / 2 - 132, H - 114, 80, 6, 9990, "");
  P("rope", W / 2 + 52, H - 114, 80, 6, 9990, "");
  ([[470, 760], [980, 760], [1120, 820], [560, 880], [900, 880]] as const).forEach(([x, y], i) =>
    i % 2 ? add("PlantSmall", x, y, 32, 64, y + 64) : add("Plant", x, y, 96, 96, y + 96));
  // CEO plaque
  P("plq", 536, 46, 0, 0, 46, "DEAL<br>CLOSED");

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
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
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
              dangerouslySetInnerHTML={{ __html: p.inner }}
            />
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

const CSS = `
.fxo{--gold:#d4a82a;--gold2:#f5d773;--navy:#0b1220;--wall:#161d2e;--wall2:#0e1526;width:100%;display:flex;justify-content:center;background:#05070d;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.fxo .stage-scroll{width:100%;overflow:auto;display:flex;justify-content:center;padding:16px}
.fxo .wrap{position:relative;flex:none;width:${W}px;height:${H}px;image-rendering:pixelated;border-radius:16px;overflow:hidden;box-shadow:0 40px 100px rgba(0,0,0,.8);border:14px solid #0c1322;outline:1px solid #263d5c}
.fxo .floor{position:absolute;inset:0;background-repeat:repeat}
.fxo .rf{position:absolute;z-index:1;image-rendering:pixelated;background-repeat:repeat;box-shadow:inset 0 0 48px rgba(0,0,0,.5),inset 0 16px 26px rgba(0,0,0,.45),inset 10px 0 18px rgba(0,0,0,.3),inset -10px 0 18px rgba(0,0,0,.3)}
.fxo .rw{position:absolute;z-index:2;box-sizing:border-box;border:13px solid var(--wall);border-top-color:#2d3a56;border-left-color:#243049;border-right-color:#0a0f1c;border-bottom-color:#070b15;border-radius:5px;box-shadow:inset 0 0 0 2px rgba(212,168,42,.45),inset 0 13px 18px rgba(0,0,0,.55),inset 0 -8px 14px rgba(0,0,0,.45),inset 13px 0 16px rgba(0,0,0,.3),inset -13px 0 16px rgba(0,0,0,.35),0 12px 28px rgba(0,0,0,.6);pointer-events:none}
.fxo .brk{position:absolute;width:20px;height:20px;z-index:6;pointer-events:none;filter:drop-shadow(0 0 3px rgba(245,215,115,.5))}
.fxo .brk.tl{border-top:4px solid var(--gold);border-left:4px solid var(--gold)}
.fxo .brk.tr{border-top:4px solid var(--gold);border-right:4px solid var(--gold)}
.fxo .brk.bl{border-bottom:4px solid var(--gold);border-left:4px solid var(--gold)}
.fxo .brk.br{border-bottom:4px solid var(--gold);border-right:4px solid var(--gold)}
.fxo .rl{position:absolute;transform:translateX(-50%);z-index:900;font-size:11px;font-weight:700;letter-spacing:.14em;color:var(--gold2);background:linear-gradient(180deg,#141c2e,#0c1322);border:1px solid var(--gold);border-radius:4px;padding:4px 12px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.6),inset 0 0 0 1px rgba(245,215,115,.2)}
.fxo .f{position:absolute;image-rendering:pixelated;filter:drop-shadow(0 3px 2px rgba(0,0,0,.6)) drop-shadow(0 6px 5px rgba(0,0,0,.28)) saturate(1.06) contrast(1.04)}
.fxo .pnl{position:absolute}
.fxo .chart{position:absolute;width:26px;height:18px;border-radius:1px;pointer-events:none}
.fxo .chart.green{background:linear-gradient(135deg,transparent 46%,#4ade80 46% 54%,transparent 54%),linear-gradient(#08160f,#0a2016);box-shadow:0 0 6px rgba(74,222,128,.45),inset 0 0 0 1px rgba(74,222,128,.35)}
.fxo .chart.blue{background:linear-gradient(135deg,transparent 46%,#60a5fa 46% 54%,transparent 54%),linear-gradient(#081222,#0a1830);box-shadow:0 0 6px rgba(96,165,250,.45),inset 0 0 0 1px rgba(96,165,250,.35)}
.fxo .skyline{border:5px solid #2a2015;border-radius:2px;background:linear-gradient(180deg,#67b7e8 0%,#8fd0f0 55%,#cfeaf7 100%);box-shadow:inset 0 0 0 2px #14324a,0 3px 8px rgba(0,0,0,.5);overflow:hidden}
.fxo .skyline::after{content:"";position:absolute;left:0;right:0;bottom:0;height:64%;background:repeating-linear-gradient(90deg,#1b3350 0 18px,#24405f 18px 22px,transparent 22px 40px),repeating-linear-gradient(90deg,transparent 0 40px,#182c46 40px 66px,transparent 66px 84px);opacity:.92}
.fxo .plq{background:linear-gradient(180deg,#2a3550,#141c2e);border:2px solid var(--gold);border-radius:3px;color:var(--gold2);font-size:8px;font-weight:700;letter-spacing:.1em;text-align:center;padding:5px 6px;line-height:1.25;box-shadow:0 2px 6px rgba(0,0,0,.5)}
.fxo .board-deal{background:linear-gradient(180deg,#f3f0e6,#e6e1d0);border:4px solid #2a3550;border-radius:2px;padding:6px 8px;color:#1b2740;box-shadow:0 3px 8px rgba(0,0,0,.5)}
.fxo .board-deal .bh{font-size:9px;font-weight:800;letter-spacing:.06em;border-bottom:2px solid var(--gold);padding-bottom:2px;margin-bottom:3px;color:#22304d}
.fxo .board-deal ul{list-style:none;font-size:7.5px;line-height:1.5}
.fxo .board-deal li::before{content:"▸ ";color:#c08a1a}
.fxo .board-deal .pie{position:absolute;right:8px;bottom:8px;width:24px;height:24px;border-radius:50%;background:conic-gradient(#3b82f6 0 45%,#22c55e 45% 72%,#eab308 72% 100%)}
.fxo .ticker-panel{background:linear-gradient(180deg,#0a0f1c,#05070d);border:3px solid #1c2740;border-radius:3px;display:flex;flex-wrap:wrap;align-content:center;gap:2px 14px;padding:5px 8px;font-size:8px;color:#8ba0bd;letter-spacing:.04em;box-shadow:inset 0 0 0 1px rgba(212,168,42,.25),0 3px 8px rgba(0,0,0,.5)}
.fxo .ticker-panel b.up{color:#34d399}.fxo .ticker-panel b.dn{color:#f87171}
.fxo .whiteboard{background:#f6f7f4;border:4px solid #33405c;border-radius:2px;padding:6px 8px;box-shadow:0 3px 8px rgba(0,0,0,.5)}
.fxo .whiteboard .wbh{font-size:8px;font-weight:800;color:#33405c;letter-spacing:.14em;margin-bottom:4px}
.fxo .wbcharts{display:flex;gap:8px;height:66px}
.fxo .wbcharts .ln{flex:1;background:linear-gradient(90deg,#2563eb 0 100%) bottom/100% 2px no-repeat,repeating-linear-gradient(45deg,transparent 0 6px,rgba(37,99,235,.5) 6px 7px);border:1px solid #cdd5e2}
.fxo .wbcharts .br{flex:1;background:linear-gradient(90deg,#22c55e 20% 30%,transparent 0),linear-gradient(90deg,transparent 40%,#3b82f6 40% 55%,transparent 0),linear-gradient(0deg,#eab308 0 40%,transparent 0);background-position:bottom;border:1px solid #cdd5e2}
.fxo .wbcharts .pi{width:46px;border-radius:50%;background:conic-gradient(#3b82f6 0 40%,#22c55e 40% 68%,#eab308 68% 100%);align-self:center;height:46px;flex:none}
.fxo .kanban{background:#eef1f6;border:4px solid #2f3d59;border-radius:2px;padding:5px 6px;box-shadow:0 3px 8px rgba(0,0,0,.5)}
.fxo .kanban .kh{font-size:8px;font-weight:800;color:#2f3d59;letter-spacing:.14em;text-align:center;margin-bottom:3px}
.fxo .kanban .cols{display:flex;gap:5px}
.fxo .kanban .col{flex:1;background:#dfe4ee;border-radius:2px;padding:3px}
.fxo .kanban .col b{display:block;font-size:5.5px;color:#54617e;letter-spacing:.03em;margin-bottom:3px}
.fxo .kanban .col i{display:block;height:8px;border-radius:1px;margin-bottom:3px;background:#f6c744}
.fxo .kanban .col:nth-child(3) i{background:#7dd3a8}
.fxo .status{background:linear-gradient(180deg,#101827,#0a0f1c);border:3px solid #24314c;border-radius:2px;padding:6px;color:#9fb3ce;box-shadow:0 3px 8px rgba(0,0,0,.5)}
.fxo .status .sh{font-size:8px;font-weight:800;color:var(--gold2);letter-spacing:.1em;margin-bottom:4px}
.fxo .status ul{list-style:none;font-size:7.5px;line-height:1.7}
.fxo .status li::before{content:"● ";color:#34d399;font-size:7px}
.fxo .server{background:linear-gradient(180deg,#161d2b,#0c111c);border:2px solid #2a3550;border-radius:2px;padding:5px 4px;display:flex;flex-direction:column;gap:5px;box-shadow:0 3px 8px rgba(0,0,0,.5)}
.fxo .server i{display:block;height:10px;background:#0a0f18;border-radius:1px;box-shadow:inset 6px 0 0 -4px #34d399,inset 12px 0 0 -10px #f6c744}
.fxo .neon{background:#1a0f14;border:3px solid #3a2530;border-radius:4px;color:#ff5ea8;font-size:14px;font-weight:800;letter-spacing:.06em;text-align:center;display:flex;align-items:center;justify-content:center;line-height:1.05;text-shadow:0 0 6px #ff5ea8,0 0 12px #ff2e86;box-shadow:0 0 14px rgba(255,46,134,.5),inset 0 0 10px rgba(255,94,168,.25)}
.fxo .campaign{background:#f2efe4;border:3px solid #6b4a2a;border-radius:2px;display:flex;align-items:center;justify-content:center;text-align:center;box-shadow:0 3px 8px rgba(0,0,0,.5)}
.fxo .campaign .ch{font-size:8px;font-weight:800;color:#6b4a2a;letter-spacing:.08em;line-height:1.2}
.fxo .artgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:5px;background:#efe7d8;border:3px solid #6b4a2a;border-radius:2px;box-shadow:0 3px 8px rgba(0,0,0,.5)}
.fxo .artgrid i{background:linear-gradient(135deg,#9db8d6,#6d8bb0);border:1px solid #fff;border-radius:1px}
.fxo .certs{display:flex;gap:6px;align-items:center;justify-content:center}
.fxo .certs span{width:30px;height:38px;background:linear-gradient(180deg,#f3efe0,#e2d9c2);border:2px solid var(--gold);border-radius:1px;box-shadow:0 1px 3px rgba(0,0,0,.5)}
.fxo .artframe{border:4px solid #6b4a2a;border-radius:2px;overflow:hidden;box-shadow:0 3px 8px rgba(0,0,0,.5)}
.fxo .artframe .scene{position:absolute;inset:0;background:linear-gradient(180deg,#bfe0f2 0 55%,#6fae6a 55% 100%)}
.fxo .scales .beam{position:absolute;left:0;right:0;top:6px;height:3px;background:var(--gold2);border-radius:2px}
.fxo .scales .beam::before{content:"";position:absolute;left:50%;top:-6px;width:3px;height:12px;background:var(--gold2);transform:translateX(-50%)}
.fxo .scales .pan{position:absolute;top:16px;width:10px;height:6px;border:2px solid var(--gold2);border-top:none;border-radius:0 0 8px 8px}
.fxo .scales .pan.l{left:-1px}.fxo .scales .pan.r{right:-1px}
.fxo .recsign{background:linear-gradient(180deg,#1a2338,#0e1524);border:3px solid var(--gold);border-radius:6px;display:flex;align-items:center;justify-content:center;gap:8px;color:var(--gold2);font-size:17px;font-weight:800;letter-spacing:.02em;box-shadow:0 4px 12px rgba(0,0,0,.6),inset 0 0 0 1px rgba(245,215,115,.25)}
.fxo .recsign .rbar{width:16px;height:16px;background:linear-gradient(0deg,var(--gold) 0 33%,transparent 0) 0 100%/4px 100% no-repeat,linear-gradient(0deg,var(--gold) 0 66%,transparent 0) 6px 100%/4px 100% no-repeat,linear-gradient(0deg,var(--gold) 0 100%,transparent 0) 12px 100%/4px 100% no-repeat}
.fxo .recdesk{background:linear-gradient(180deg,#c9a875,#9c7b4e);border:3px solid #5f451f;border-radius:60px 60px 8px 8px;box-shadow:inset 0 4px 0 rgba(255,255,255,.15),0 6px 14px rgba(0,0,0,.5)}
.fxo .welcome{background:linear-gradient(180deg,#2a3550,#141c2e);border:2px solid var(--gold);border-radius:4px;color:var(--gold2);font-size:12px;font-weight:800;letter-spacing:.3em;text-align:center;line-height:26px}
.fxo .gdoor{border:4px solid #33405c;border-radius:3px 3px 0 0;overflow:hidden;background:#0e1524;box-shadow:0 -3px 10px rgba(0,0,0,.4)}
.fxo .gdoor .gl{position:absolute;inset:0;background:linear-gradient(115deg,#2a3f5c 0%,#3a5578 40%,#8a6a34 62%,#c9a24a 100%);opacity:.85}
.fxo .gdoor .gm{position:absolute;inset:0;background:linear-gradient(90deg,transparent 48%,#33405c 48% 52%,transparent 52%)}
.fxo .stanch{background:linear-gradient(180deg,var(--gold2),#9c7b1e);border-radius:3px;box-shadow:0 2px 5px rgba(0,0,0,.5)}
.fxo .stanch::before{content:"";position:absolute;left:50%;top:-6px;width:10px;height:10px;border-radius:50%;background:var(--gold2);transform:translateX(-50%)}
.fxo .rope{background:linear-gradient(180deg,#7a1f2b,#4d121a);border-radius:4px}
.fxo .lightpool{position:absolute;inset:0;z-index:950;pointer-events:none;background:radial-gradient(58% 48% at 50% 44%,rgba(255,216,140,.10),transparent 70%)}
.fxo .vig{position:absolute;inset:0;z-index:1200;pointer-events:none;box-shadow:inset 0 0 220px rgba(2,5,12,.72)}
`;
