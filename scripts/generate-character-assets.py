#!/usr/bin/env python3
"""Generate FundExecs OS 16-bit character packs without third-party deps."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
CHAR_DIR = PUBLIC / "assets" / "fundexecs" / "characters"
PACK_DIR = PUBLIC / "assets" / "fundexecs" / "character-packs"


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    value = hex_color.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), alpha


def mix(a: tuple[int, int, int, int], b: tuple[int, int, int, int], t: float) -> tuple[int, int, int, int]:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(4))  # type: ignore[return-value]


def shade(c: tuple[int, int, int, int], f: float) -> tuple[int, int, int, int]:
    return tuple(max(0, min(255, round(c[i] * f))) if i < 3 else c[i] for i in range(4))  # type: ignore[return-value]


class Img:
    def __init__(self, w: int, h: int, bg: tuple[int, int, int, int] = (0, 0, 0, 0)):
        self.w = w
        self.h = h
        self.px = bytearray(bg * (w * h))

    def set(self, x: int, y: int, c: tuple[int, int, int, int]) -> None:
        if x < 0 or y < 0 or x >= self.w or y >= self.h or c[3] <= 0:
            return
        i = (y * self.w + x) * 4
        if c[3] == 255:
            self.px[i : i + 4] = bytes(c)
            return
        a = c[3] / 255
        ia = 1 - a
        self.px[i] = round(c[0] * a + self.px[i] * ia)
        self.px[i + 1] = round(c[1] * a + self.px[i + 1] * ia)
        self.px[i + 2] = round(c[2] * a + self.px[i + 2] * ia)
        self.px[i + 3] = min(255, round(c[3] + self.px[i + 3] * ia))

    def rect(self, x: int, y: int, w: int, h: int, c: tuple[int, int, int, int]) -> None:
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(xx, yy, c)

    def circle(self, cx: int, cy: int, r: int, c: tuple[int, int, int, int]) -> None:
        rr = r * r
        for yy in range(cy - r, cy + r + 1):
            for xx in range(cx - r, cx + r + 1):
                if (xx - cx) ** 2 + (yy - cy) ** 2 <= rr:
                    self.set(xx, yy, c)

    def ellipse(self, cx: int, cy: int, rx: int, ry: int, c: tuple[int, int, int, int]) -> None:
        if rx <= 0 or ry <= 0:
            return
        for yy in range(cy - ry, cy + ry + 1):
            for xx in range(cx - rx, cx + rx + 1):
                if ((xx - cx) ** 2) / (rx * rx) + ((yy - cy) ** 2) / (ry * ry) <= 1:
                    self.set(xx, yy, c)

    def line(self, x0: int, y0: int, x1: int, y1: int, c: tuple[int, int, int, int]) -> None:
        dx = abs(x1 - x0)
        sx = 1 if x0 < x1 else -1
        dy = -abs(y1 - y0)
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            self.set(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def grad(self, top: tuple[int, int, int, int], bottom: tuple[int, int, int, int]) -> None:
        for y in range(self.h):
            c = mix(top, bottom, y / max(1, self.h - 1))
            self.rect(0, y, self.w, 1, c)

    def paste_scaled(self, src: "Img", x: int, y: int, scale: int) -> None:
        for sy in range(src.h):
            for sx in range(src.w):
                i = (sy * src.w + sx) * 4
                c = tuple(src.px[i : i + 4])  # type: ignore[assignment]
                if c[3]:
                    self.rect(x + sx * scale, y + sy * scale, scale, scale, c)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = b"".join(b"\x00" + self.px[y * self.w * 4 : (y + 1) * self.w * 4] for y in range(self.h))

        def chunk(kind: bytes, data: bytes) -> bytes:
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

        data = b"\x89PNG\r\n\x1a\n"
        data += chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
        data += chunk(b"IDAT", zlib.compress(raw, 9))
        data += chunk(b"IEND", b"")
        path.write_bytes(data)


CHARS = [
    ("earnest-fundmaker", "Earn", "#fbbf24", "#f7d46a", "#241a12", "#17140d", "coin"),
    ("capital-connector", "Capital Connector", "#14b8a6", "#c68642", "#1a1a1a", "#1f2a3d", "capital"),
    ("deal-sourcer", "Deal Sourcer", "#f97316", "#e0a878", "#4a3728", "#2b2f38", "files"),
    ("capital-raiser", "Capital Raiser", "#ec4899", "#f1c9a5", "#6b4a2f", "#1a2436", "chart"),
    ("investor-relations", "Investor Relations", "#f59e0b", "#8d5524", "#2b2320", "#33383f", "envelope"),
    ("automater", "Automater", "#22c55e", "#d9a066", "#3a2a1a", "#262b33", "kpi"),
    ("curator", "Curator", "#d946ef", "#f7d9bf", "#2b2320", "#3a2f2a", "network"),
    ("workflow-instructor", "Workflow Instructor", "#ef4444", "#a9713f", "#1a1a1a", "#1c1c22", "shield"),
    ("lead-generator", "Lead Generator", "#84cc16", "#ffdbb0", "#6e3b1f", "#29331f", "network"),
    ("pr-director", "PR Director", "#06b6d4", "#c68642", "#1a1a1a", "#203040", "document"),
    ("executive-advisor", "Executive Advisor", "#a855f7", "#e0a878", "#8a8a8a", "#272238", "folder"),
    ("rainmaker", "Rainmaker", "#fbbf24", "#d9a066", "#2b2320", "#3a2f2a", "capital"),
    ("seo-disruptor", "SEO Disruptor", "#8b5cf6", "#f1c9a5", "#4a3728", "#202235", "chart"),
    ("legal-admin", "Legal Admin", "#64748b", "#8d5524", "#1a1a1a", "#28313b", "document"),
    ("office-manager", "Office Manager", "#94a3b8", "#ffdbb0", "#6b4a2f", "#29313b", "calendar"),
    ("master-workflow", "Master Workflow", "#be123c", "#c68642", "#2b2320", "#2b1d23", "command"),
]


def draw_prop(img: Img, x: int, y: int, prop: str, accent: tuple[int, int, int, int]) -> None:
    dark = rgba("#05070a")
    pale = rgba("#f3ead8")
    if prop in {"files", "folder", "document"}:
        img.rect(x + 11, y + 16, 4, 5, pale)
        img.rect(x + 12, y + 17, 3, 1, accent)
        img.line(x + 12, y + 19, x + 14, y + 19, dark)
    elif prop in {"chart", "kpi"}:
        img.rect(x + 1, y + 16, 4, 5, rgba("#09111c"))
        img.rect(x + 2, y + 19, 1, 1, accent)
        img.rect(x + 3, y + 18, 1, 2, accent)
        img.rect(x + 4, y + 17, 1, 3, accent)
    elif prop == "shield":
        img.rect(x + 11, y + 16, 4, 4, accent)
        img.rect(x + 12, y + 20, 2, 1, accent)
    elif prop in {"capital", "command"}:
        img.circle(x + 13, y + 18, 2, accent)
        img.circle(x + 13, y + 18, 1, shade(accent, 1.28))
    elif prop in {"envelope", "calendar"}:
        img.rect(x + 1, y + 16, 4, 4, pale)
        img.line(x + 1, y + 16, x + 3, y + 18, accent)
        img.line(x + 5, y + 16, x + 3, y + 18, accent)
    elif prop == "network":
        for dx, dy in [(2, 17), (5, 16), (4, 20)]:
            img.circle(x + dx, y + dy, 1, accent)
        img.line(x + 2, y + 17, x + 5, y + 16, accent)
        img.line(x + 5, y + 16, x + 4, y + 20, accent)


def draw_exec(img: Img, ox: int, oy: int, accent_hex: str, skin_hex: str, hair_hex: str, suit_hex: str, prop: str, state: str, frame: int) -> None:
    accent, skin, hair, suit = rgba(accent_hex), rgba(skin_hex), rgba(hair_hex), rgba(suit_hex)
    shirt = rgba("#e9eef5")
    outline = rgba("#050507")
    trouser = shade(suit, 0.65)
    bob = 1 if frame % 4 in {1, 2} and state.startswith("walk") else 0
    talk = 1 if state == "talk" and frame % 2 else 0
    success = state == "success"
    y = oy - bob
    img.ellipse(ox + 8, oy + 30, 6, 1, rgba("#000000", 90))
    img.rect(ox + 5, y + 20, 3, 8, outline)
    img.rect(ox + 9, y + 20, 3, 8, outline)
    img.rect(ox + 5, y + 19, 3, 8, trouser)
    img.rect(ox + 9, y + 19, 3, 8, trouser)
    img.rect(ox + 4, y + 27, 5, 2, outline)
    img.rect(ox + 8, y + 27, 5, 2, outline)
    img.rect(ox + 3, y + 11, 10, 10, outline)
    img.rect(ox + 4, y + 11, 8, 10, suit)
    img.rect(ox + 6, y + 11, 4, 7, shirt)
    img.rect(ox + 7, y + 12, 2, 7, accent)
    img.rect(ox + 3, y + 12, 2, 8, suit)
    img.rect(ox + 12, y + 12, 2, 8, suit)
    img.rect(ox + 3, y + 19, 2, 2, skin)
    img.rect(ox + 12, y + 19, 2, 2, skin)
    draw_prop(img, ox, y, prop if frame % 4 in {0, 1} else "none", accent)
    img.rect(ox + 6, y + 8, 4, 4, skin)
    img.circle(ox + 8, y + 7, 5, outline)
    img.circle(ox + 8, y + 7, 4, skin)
    img.rect(ox + 4, y + 3, 9, 4, hair)
    img.rect(ox + 4, y + 5, 2, 4, hair)
    img.rect(ox + 11, y + 5, 1, 3, hair)
    img.set(ox + 6, y + 7, outline)
    img.set(ox + 10, y + 7, outline)
    if success:
        img.rect(ox + 6, y + 10, 5, 1, rgba("#6b3d28"))
        img.rect(ox + 2, y + 9, 2, 2, accent)
        img.rect(ox + 12, y + 9, 2, 2, accent)
    elif talk:
        img.rect(ox + 7, y + 10, 3, 1, rgba("#6b3d28"))
    else:
        img.set(ox + 8, y + 10, rgba("#6b3d28"))
    img.rect(ox + 5, y + 4, 2, 1, shade(hair, 1.35))
    if prop in {"chart", "document", "folder"}:
        img.rect(ox + 10, y + 6, 4, 1, rgba("#0f172a"))


def draw_coin(img: Img, ox: int, oy: int, state: str, frame: int) -> None:
    bob = 1 if frame % 4 in {1, 2} and state.startswith("walk") else 0
    y = oy - bob
    gold, dark, white = rgba("#f4c53d"), rgba("#17120a"), rgba("#f9f2df")
    rim, shade_gold = rgba("#9b6816"), rgba("#d79722")
    img.ellipse(ox + 16, oy + 30, 9, 2, rgba("#000000", 100))
    img.rect(ox + 10, y + 21, 3, 7, dark)
    img.rect(ox + 19, y + 21, 3, 7, dark)
    img.ellipse(ox + 11, y + 28, 5, 2, white)
    img.ellipse(ox + 21, y + 28, 5, 2, white)
    img.line(ox + 6, y + 14, ox + 2, y + 18, dark)
    img.line(ox + 26, y + 14, ox + 30, y + 18, dark)
    img.circle(ox + 2, y + 18, 3, white)
    img.circle(ox + 30, y + 18, 3, white)
    img.circle(ox + 16, y + 13, 12, rgba("#050507"))
    img.circle(ox + 16, y + 13, 11, rim)
    img.circle(ox + 16, y + 13, 10, gold)
    img.ellipse(ox + 16, y + 18, 8, 4, shade_gold)
    img.ellipse(ox + 13, y + 9, 5, 3, rgba("#ffe992", 220))
    img.circle(ox + 12, y + 12, 2, dark)
    img.circle(ox + 20, y + 12, 2, dark)
    img.set(ox + 11, y + 11, white)
    img.set(ox + 19, y + 11, white)
    if state == "talk" and frame % 2:
        img.rect(ox + 14, y + 17, 5, 2, dark)
    else:
        img.line(ox + 13, y + 17, ox + 18, y + 18, dark)
        img.line(ox + 18, y + 18, ox + 20, y + 17, dark)
    if state == "loading":
        angle = (frame / 6) * math.tau
        img.circle(ox + 16 + round(math.cos(angle) * 14), y + 13 + round(math.sin(angle) * 14), 2, rgba("#38bdf8"))


def make_sheet(ch: tuple[str, str, str, str, str, str, str]) -> Img:
    slug, _, accent, skin, hair, suit, prop = ch
    if prop == "coin":
        sheet = Img(32 * 6, 32 * 8)
        rows = ["idle", "walkDown", "walkUp", "walkLeft", "walkRight", "talk", "success", "loading"]
        for row, state in enumerate(rows):
            frames = 6 if state == "loading" else 4
            for frame in range(frames):
                draw_coin(sheet, frame * 32, row * 32, state, frame)
        return sheet
    sheet = Img(16 * 4, 32 * 7)
    rows = ["idle", "walkDown", "walkUp", "walkLeft", "walkRight", "talk", "success"]
    for row, state in enumerate(rows):
        for frame in range(4):
            draw_exec(sheet, frame * 16, row * 32, accent, skin, hair, suit, prop, state, frame)
    return sheet


def make_hero(ch: tuple[str, str, str, str, str, str, str], size: int = 256) -> Img:
    slug, _, accent, *_ = ch
    out = Img(size, size)
    out.ellipse(size // 2, int(size * 0.82), int(size * 0.27), int(size * 0.06), rgba("#000000", 120))
    out.circle(size // 2, size // 2, int(size * 0.45), rgba(accent, 36))
    frame = Img(32, 32) if slug == "earnest-fundmaker" else Img(16, 32)
    if slug == "earnest-fundmaker":
        draw_coin(frame, 0, 0, "idle", 1)
        out.paste_scaled(frame, (size - 32 * 6) // 2, 28, 6)
    else:
        _, _, acc, skin, hair, suit, prop = ch
        draw_exec(frame, 0, 0, acc, skin, hair, suit, prop, "idle", 1)
        out.paste_scaled(frame, (size - 16 * 6) // 2, 24, 6)
    return out


def make_card(ch: tuple[str, str, str, str, str, str, str]) -> Img:
    _, _, accent, *_ = ch
    bg = Img(512, 640)
    bg.grad(rgba("#101827"), rgba("#050609"))
    bg.rect(28, 28, 456, 584, rgba("#ffffff", 12))
    bg.rect(30, 30, 452, 580, rgba("#05070a", 220))
    for i in range(0, 512, 32):
        bg.line(i, 0, i, 640, rgba("#ffffff", 8))
    bg.circle(256, 270, 190, rgba(accent, 32))
    bg.paste_scaled(make_hero(ch, 256), 128, 98, 1)
    bg.rect(72, 500, 368, 4, rgba(accent))
    bg.rect(72, 520, 220, 18, rgba(accent, 160))
    bg.rect(72, 552, 320, 12, rgba("#e5e7eb", 80))
    return bg


def make_pack(path: Path, chars: list[tuple[str, str, str, str, str, str, str]], title_accent: str) -> None:
    out = Img(1536, 1024)
    out.grad(rgba("#111827"), rgba("#030407"))
    for x in range(0, out.w, 32):
        out.line(x, 0, x, out.h, rgba("#ffffff", 8))
    for y in range(0, out.h, 32):
        out.line(0, y, out.w, y, rgba("#ffffff", 8))
    out.rect(64, 64, 1408, 896, rgba("#ffffff", 10))
    out.rect(68, 68, 1400, 888, rgba("#05070a", 180))
    out.rect(96, 104, 420, 12, rgba(title_accent))
    out.rect(96, 132, 760, 24, rgba("#e5e7eb", 62))
    out.rect(96, 170, 560, 16, rgba("#94a3b8", 56))
    cols = 4
    cell_w, cell_h = 320, 360
    start_x, start_y = 130, 230
    for idx, ch in enumerate(chars[:8]):
        col = idx % cols
        row = idx // cols
        x = start_x + col * cell_w
        y = start_y + row * cell_h
        accent = ch[2]
        out.rect(x, y, 250, 290, rgba("#ffffff", 12))
        out.rect(x + 3, y + 3, 244, 284, rgba("#080b12", 230))
        out.circle(x + 125, y + 126, 90, rgba(accent, 36))
        out.paste_scaled(make_hero(ch, 220), x + 15, y + 20, 1)
        out.rect(x + 28, y + 250, 130, 8, rgba(accent))
        out.rect(x + 28, y + 268, 180, 6, rgba("#e5e7eb", 72))
    out.save(path)


def make_earn_coin() -> None:
    low = Img(256, 256)
    low.grad(rgba("#101827"), rgba("#050609"))
    for r, c in [(94, "#050507"), (88, "#9b6816"), (80, "#f4c53d")]:
        low.circle(128, 128, r, rgba(c))
    low.ellipse(118, 94, 44, 24, rgba("#ffe992", 220))
    low.ellipse(128, 166, 62, 30, rgba("#d79722", 170))
    low.circle(104, 122, 13, rgba("#241a12"))
    low.circle(152, 122, 13, rgba("#241a12"))
    low.circle(99, 116, 4, rgba("#f9f2df"))
    low.circle(147, 116, 4, rgba("#f9f2df"))
    low.line(104, 157, 122, 168, rgba("#241a12"))
    low.line(122, 168, 152, 157, rgba("#241a12"))
    out = Img(1024, 1024)
    out.paste_scaled(low, 0, 0, 4)
    out.save(PUBLIC / "earn-coin.png")
    icon192 = Img(192, 192)
    icon192.paste_scaled(low, 0, 0, 1)
    icon192.save(PUBLIC / "icon-192.png")
    icon512 = Img(512, 512)
    icon512.paste_scaled(low, 0, 0, 2)
    icon512.save(PUBLIC / "icon-512.png")


def main() -> None:
    make_earn_coin()
    for ch in CHARS:
        slug = ch[0]
        target = CHAR_DIR / slug
        sheet = make_sheet(ch)
        sheet.save(target / f"{slug}.png")
        make_hero(ch, 256).save(target / "sprite.png")
        make_card(ch).save(target / "card.png")
        if slug == "earnest-fundmaker":
            make_hero(ch, 1024).save(target / "high-def.png")
    customizable = [
        ("operator-closer", "Closer", "#c9a84c", "#e0a878", "#2b2320", "#2b2f38", "capital"),
        ("operator-strategist", "Strategist", "#2f8f83", "#f1c9a5", "#4a3728", "#1f2a3d", "folder"),
        ("operator-rainmaker", "Rainmaker", "#9b3b47", "#c68642", "#1a1a1a", "#3a2f2a", "network"),
        ("operator-analyst", "Analyst", "#4aa3d6", "#ffdbb0", "#6b4a2f", "#33383f", "chart"),
        ("operator-diplomat", "Diplomat", "#7d4a8f", "#8d5524", "#2b2320", "#4a4e57", "envelope"),
        ("operator-founder", "Founder", "#b87333", "#d9a066", "#3a2a1a", "#1a2436", "command"),
        ("operator-steward", "Steward", "#64748b", "#f7d9bf", "#8a8a8a", "#28313b", "shield"),
        ("operator-builder", "Builder", "#22c55e", "#a9713f", "#1a1a1a", "#29331f", "kpi"),
    ]
    make_pack(PACK_DIR / "customizables" / "studio-pack.png", customizable, "#c9a84c")
    make_pack(PACK_DIR / "agents" / "executive-agent-pack.png", CHARS, "#38bdf8")


if __name__ == "__main__":
    main()
