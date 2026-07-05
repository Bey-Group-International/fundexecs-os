import * as Phaser from "phaser";
import type { AvatarSpec } from "./avatarPalette";
import type { AgentState } from "../program/officeProgram";

export type AvatarFacing = "down" | "up" | "left" | "right";

/**
 * A humanized executive avatar drawn entirely from canvas primitives —
 * no sprite sheets, no boxes. Composed of layered vector shapes (head,
 * hair, blazer with lapels, tie/accent, arms, legs, shadow) into a
 * recognizable professional figure with a four-way facing and a discrete
 * walk cycle.
 *
 * Rendering is cheap: the body is only redrawn when the visible pose
 * changes (facing or walk step), never every frame. Idle motion is a
 * transform-only breathing bob; AI agents add a tweened glow aura that
 * pulses only while actively working.
 *
 * The avatar rides on top of the scene's existing position anchors
 * (the arcade physics sprites / NPC path targets), so all movement,
 * collision, and networking logic is untouched.
 */
export class ExecutiveAvatar {
  readonly container: Phaser.GameObjects.Container;

  private scene: Phaser.Scene;
  private spec: AvatarSpec;

  private shadow: Phaser.GameObjects.Ellipse;
  private aura: Phaser.GameObjects.Arc;
  private body: Phaser.GameObjects.Graphics;

  private facing: AvatarFacing = "down";
  private walking = false;
  private programState: AgentState = "idle";

  private walkPhase = 0;
  private bobPhase = Math.random() * Math.PI * 2;
  private lastPoseKey = "";

  constructor(scene: Phaser.Scene, x: number, y: number, spec: AvatarSpec, depth = 8) {
    this.scene = scene;
    this.spec = spec;

    this.shadow = scene.add.ellipse(0, 15, 17, 6, 0x000000, 0.28);
    this.aura = scene.add.arc(0, 6, 13, 0, 360, false)
      .setStrokeStyle(1.5, spec.accent, 0.85)
      .setFillStyle(spec.accent, 0.06)
      .setVisible(false);
    this.body = scene.add.graphics();

    this.container = scene.add.container(x, y, [this.shadow, this.aura, this.body]);
    this.container.setDepth(depth);

    this._redraw();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setPosition(x: number, y: number) {
    this.container.setPosition(x, y);
  }

  get x() { return this.container.x; }
  get y() { return this.container.y; }

  setFacing(facing: AvatarFacing) {
    if (this.facing !== facing) {
      this.facing = facing;
      this._redraw();
    }
  }

  setWalking(walking: boolean) {
    if (this.walking === walking) return;
    this.walking = walking;
    if (!walking) {
      this.walkPhase = 0;
      this._redraw();
    }
  }

  /** Program state drives the AI aura color and whether it pulses. */
  setState(state: AgentState) {
    if (this.programState === state) return;
    this.programState = state;
    this._applyAura();
  }

  /** Make the figure clickable; the whole silhouette is the hit target. */
  setInteractive(onClick: () => void) {
    this.container.setSize(24, 40);
    this.container.setInteractive({ useHandCursor: true });
    this.container.on("pointerdown", onClick);
    this.container.on("pointerover", () => this.body.setAlpha(0.82));
    this.container.on("pointerout", () => this.body.setAlpha(1));
  }

  /** Per-frame animation: advance the walk cycle or breathe while idle. */
  update(delta: number) {
    if (this.walking) {
      this.walkPhase += (delta / 1000) * 9; // ~9 steps/sec
      const step = Math.floor(this.walkPhase) % 4;
      const key = `${this.facing}:w${step}:${this.spec.kind}`;
      if (key !== this.lastPoseKey) this._redraw();
      this.container.y += 0; // vertical handled by anchor
    } else {
      // Subtle breathing bob — transform only, no redraw.
      this.bobPhase += delta / 1000;
      const bob = Math.sin(this.bobPhase * 1.6) * 0.4;
      this.body.setY(bob);
    }
  }

  destroy() {
    this.scene.tweens.killTweensOf(this.aura);
    this.container.destroy(true);
  }

  // ── Aura (AI-native cue) ────────────────────────────────────────────────────

  private _applyAura() {
    const colors: Partial<Record<AgentState, number>> = {
      classifying: 0xfbbf24,
      listening: 0xfbbf24,
      assigned: 0xc9a84c,
      moving: 0xc9a84c,
      working: 0x38bdf8,
      collaborating: 0x38bdf8,
      reviewing: 0xa855f7,
      waiting_for_approval: 0xf59e0b,
      complete: 0x22c55e,
      blocked: 0xef4444,
    };
    this.scene.tweens.killTweensOf(this.aura);
    const color = colors[this.programState];
    if (!color) {
      this.aura.setVisible(false);
      return;
    }
    this.aura.setVisible(true);
    this.aura.setStrokeStyle(1.5, color, 0.85);
    this.aura.setFillStyle(color, 0.07);
    this.aura.setScale(1).setAlpha(1);
    if (this.programState === "working" || this.programState === "classifying" || this.programState === "waiting_for_approval") {
      this.scene.tweens.add({
        targets: this.aura, scale: 1.24, alpha: 0.5,
        duration: 850, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
      });
    }
  }

  // ── Figure drawing ──────────────────────────────────────────────────────────

  private _redraw() {
    const step = this.walking ? Math.floor(this.walkPhase) % 4 : -1;
    this.lastPoseKey = `${this.facing}:w${step}:${this.spec.kind}`;
    const g = this.body;
    g.clear();

    // Walk-cycle limb offsets (discrete 4-frame swing). step -1 = idle.
    // Pattern: contact → passing → contact(opp) → passing.
    const swing = step === -1 ? 0 : [3, 0, -3, 0][step];
    const s = this.spec;

    if (this.facing === "up") this._drawBack(g, s, swing);
    else if (this.facing === "left") this._drawProfile(g, s, swing, -1);
    else if (this.facing === "right") this._drawProfile(g, s, swing, 1);
    else this._drawFront(g, s, swing);
  }

  /** Front view (facing down / toward the viewer). */
  private _drawFront(g: Phaser.GameObjects.Graphics, s: AvatarSpec, swing: number) {
    // Legs
    g.fillStyle(s.trouser, 1);
    g.fillRoundedRect(-4.5, 6 - Math.max(0, swing), 3.5, 9 + Math.abs(swing) * 0.4, 1.4);
    g.fillRoundedRect(1, 6 - Math.max(0, -swing), 3.5, 9 + Math.abs(swing) * 0.4, 1.4);
    // Shoes
    g.fillStyle(0x14110d, 1);
    g.fillEllipse(-2.7, 15 - Math.max(0, swing), 4.4, 2.4);
    g.fillEllipse(2.7, 15 - Math.max(0, -swing), 4.4, 2.4);

    // Arms (behind torso, swing opposite to legs)
    g.fillStyle(s.suit, 1);
    g.fillRoundedRect(-8, -5 + swing * 0.4, 3.2, 11, 1.6);
    g.fillRoundedRect(4.8, -5 - swing * 0.4, 3.2, 11, 1.6);
    // Hands
    g.fillStyle(s.skin, 1);
    g.fillCircle(-6.4, 6 + swing * 0.4, 1.7);
    g.fillCircle(6.4, 6 - swing * 0.4, 1.7);

    // Torso — tapered blazer via polygon
    g.fillStyle(s.suit, 1);
    g.fillPoints([
      new Phaser.Geom.Point(-7, -6), new Phaser.Geom.Point(7, -6),
      new Phaser.Geom.Point(5.5, 7), new Phaser.Geom.Point(-5.5, 7),
    ], true);
    // Shirt V
    g.fillStyle(s.shirt, 1);
    g.fillTriangle(-2.6, -6, 2.6, -6, 0, 2.5);
    // Lapels
    g.fillStyle(this._shade(s.suit, 0.82), 1);
    g.fillTriangle(-3.2, -6, -0.4, -6, -2.2, 1);
    g.fillTriangle(3.2, -6, 0.4, -6, 2.2, 1);
    // Tie / accent
    g.fillStyle(s.accent, 1);
    g.fillTriangle(-1.1, -5, 1.1, -5, 0, 4);
    g.fillStyle(this._shade(s.accent, 1.15), 1);
    g.fillTriangle(-1.1, -5, 1.1, -5, 0, -3);

    // Neck + head
    g.fillStyle(s.skin, 1);
    g.fillRect(-1.7, -9, 3.4, 3.5);
    g.fillEllipse(0, -13, 9.5, 11);
    // Hair cap
    g.fillStyle(s.hair, 1);
    g.fillEllipse(0, -15.5, 10, 7);
    g.fillRect(-5, -15.5, 10, 2.5);
    // Face hints
    g.fillStyle(0x2a2320, 1);
    g.fillCircle(-2, -12.5, 0.8);
    g.fillCircle(2, -12.5, 0.8);
  }

  /** Back view (facing up / away). */
  private _drawBack(g: Phaser.GameObjects.Graphics, s: AvatarSpec, swing: number) {
    g.fillStyle(s.trouser, 1);
    g.fillRoundedRect(-4.5, 6 - Math.max(0, swing), 3.5, 9 + Math.abs(swing) * 0.4, 1.4);
    g.fillRoundedRect(1, 6 - Math.max(0, -swing), 3.5, 9 + Math.abs(swing) * 0.4, 1.4);
    g.fillStyle(0x14110d, 1);
    g.fillEllipse(-2.7, 15 - Math.max(0, swing), 4.4, 2.4);
    g.fillEllipse(2.7, 15 - Math.max(0, -swing), 4.4, 2.4);

    g.fillStyle(s.suit, 1);
    g.fillRoundedRect(-8, -5 - swing * 0.4, 3.2, 11, 1.6);
    g.fillRoundedRect(4.8, -5 + swing * 0.4, 3.2, 11, 1.6);
    g.fillStyle(s.skin, 1);
    g.fillCircle(-6.4, 6 - swing * 0.4, 1.7);
    g.fillCircle(6.4, 6 + swing * 0.4, 1.7);

    // Solid blazer back with a subtle center seam + collar
    g.fillStyle(s.suit, 1);
    g.fillPoints([
      new Phaser.Geom.Point(-7, -6), new Phaser.Geom.Point(7, -6),
      new Phaser.Geom.Point(5.5, 7), new Phaser.Geom.Point(-5.5, 7),
    ], true);
    g.lineStyle(0.6, this._shade(s.suit, 0.8), 0.8);
    g.beginPath(); g.moveTo(0, -6); g.lineTo(0, 7); g.strokePath();
    g.fillStyle(this._shade(s.suit, 0.85), 1);
    g.fillRect(-3.5, -6.5, 7, 1.6);

    g.fillStyle(s.skin, 1);
    g.fillRect(-1.7, -9, 3.4, 3.2);
    // Back of head — hair only, no face
    g.fillStyle(s.hair, 1);
    g.fillEllipse(0, -13, 9.5, 11);
  }

  /** Profile view (facing left dir=-1 / right dir=+1). */
  private _drawProfile(g: Phaser.GameObjects.Graphics, s: AvatarSpec, swing: number, dir: number) {
    // Legs (front/back leg offset along facing axis)
    g.fillStyle(s.trouser, 1);
    g.fillRoundedRect(-2 + dir * swing * 0.6, 6, 3.6, 10, 1.4);
    g.fillRoundedRect(-2 - dir * swing * 0.6, 6, 3.6, 10, 1.4);
    g.fillStyle(0x14110d, 1);
    g.fillEllipse(dir * (2.5 + swing * 0.5), 15.5, 5, 2.4);
    g.fillEllipse(-dir * (1 + swing * 0.5), 15.5, 5, 2.4);

    // Back arm
    g.fillStyle(this._shade(s.suit, 0.85), 1);
    g.fillRoundedRect(-1.7 - dir * swing * 0.7, -5, 3, 11, 1.5);

    // Torso
    g.fillStyle(s.suit, 1);
    g.fillPoints([
      new Phaser.Geom.Point(-5, -6), new Phaser.Geom.Point(5, -6),
      new Phaser.Geom.Point(4, 7), new Phaser.Geom.Point(-4, 7),
    ], true);
    // Accent placket down the facing side
    g.fillStyle(s.accent, 1);
    g.fillRect(dir * 2.4 - 0.7, -5, 1.5, 9);

    // Front arm swings across
    g.fillStyle(s.suit, 1);
    g.fillRoundedRect(-1.7 + dir * swing * 0.7, -5, 3, 11, 1.5);
    g.fillStyle(s.skin, 1);
    g.fillCircle(dir * swing * 0.7, 6, 1.7);

    // Neck + head, gently shifted toward the facing direction
    const hx = dir * 1.3;
    g.fillStyle(s.skin, 1);
    g.fillRect(hx - 1.5, -9.5, 3, 4);
    g.fillEllipse(hx, -13, 9.2, 10.8);
    // Subtle nose just past the face edge
    g.fillTriangle(hx + dir * 4.2, -13, hx + dir * 4.2, -11.6, hx + dir * 5.1, -12.4);
    // Hair — crown cap and back of the head, sitting on the skull
    g.fillStyle(s.hair, 1);
    g.fillEllipse(hx - dir * 1.4, -15, 9, 6.5);
    g.fillEllipse(hx - dir * 3.4, -13, 4.6, 8);
    // One eye on the facing side
    g.fillStyle(0x2a2320, 1);
    g.fillCircle(hx + dir * 1.9, -12.6, 0.8);
  }

  /** Multiply an 0xRRGGBB color's brightness by f. */
  private _shade(color: number, f: number): number {
    const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
    const gc = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
    const b = Math.min(255, Math.round((color & 0xff) * f));
    return (r << 16) | (gc << 8) | b;
  }
}
