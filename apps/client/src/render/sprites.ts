import { Container, Graphics, Text } from "pixi.js";

export const hexColor = (css: string): number => Number.parseInt(css.replace("#", ""), 16) || 0xffffff;

function darken(c: number, f: number): number {
  const r = Math.round(((c >> 16) & 255) * f);
  const g = Math.round(((c >> 8) & 255) * f);
  const b = Math.round((c & 255) * f);
  return (r << 16) | (g << 8) | b;
}

/** A crew-member figure: body, backpack and visor, with a name tag and an activity indicator. */
export class PlayerSprite {
  readonly root = new Container();
  private readonly figure = new Container();
  private readonly busy = new Graphics();
  private readonly label: Text;
  private facingSign = 1;
  busyPhase = 0;

  constructor(color: string, name: string, isSelf: boolean) {
    const c = hexColor(color);
    const edge = darken(c, 0.55);
    const g = new Graphics();
    g.roundRect(-17, -7, 8, 17, 3).fill(darken(c, 0.8)).stroke({ width: 2, color: edge }); // backpack
    g.roundRect(-11, -17, 23, 33, 11).fill(c).stroke({ width: 2.5, color: edge }); // body
    g.rect(-9, 10, 7, 8).fill(c).stroke({ width: 2, color: edge }); // legs
    g.rect(3, 10, 7, 8).fill(c).stroke({ width: 2, color: edge });
    g.roundRect(-1, -11, 15, 9, 4.5).fill(0x9ad8f0).stroke({ width: 2, color: 0x3d6b80 }); // visor
    g.roundRect(4, -9, 6, 2.5, 1.2).fill(0xe6f7ff);
    this.figure.addChild(g);
    this.root.addChild(this.figure);

    this.busy.visible = false;
    this.root.addChild(this.busy);

    this.label = new Text({
      text: isSelf ? `${name} (you)` : name,
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        fontWeight: "700",
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
      },
    });
    this.label.anchor.set(0.5, 1);
    this.label.position.set(0, -22);
    this.root.addChild(this.label);
  }

  update(x: number, y: number, facingX: number, ghost: boolean, busy: boolean, dtMs: number): void {
    this.root.position.set(x, y);
    if (facingX > 0.05) this.facingSign = 1;
    else if (facingX < -0.05) this.facingSign = -1;
    this.figure.scale.x = this.facingSign;
    this.root.alpha = ghost ? 0.45 : 1;
    this.busy.visible = busy;
    if (busy) {
      this.busyPhase += dtMs / 1000;
      this.busy.clear();
      for (let i = 0; i < 3; i++) {
        const a = Math.max(0.25, Math.sin(this.busyPhase * 5 - i * 0.8) * 0.5 + 0.5);
        this.busy.circle(-8 + i * 8, -42, 3).fill({ color: 0xf5d90a, alpha: a });
      }
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}

/** A body on the floor: the figure lying on its side, with a bone sticking out. */
export function bodySprite(color: string): Container {
  const c = hexColor(color);
  const edge = darken(c, 0.55);
  const root = new Container();
  const g = new Graphics();
  g.roundRect(-16, -2, 26, 14, 7).fill(c).stroke({ width: 2.5, color: edge });
  g.rect(-20, 1, 7, 8).fill(c).stroke({ width: 2, color: edge });
  g.ellipse(13, 5, 5, 6).fill(0xf0f0f0).stroke({ width: 1.5, color: 0xb0b0b0 });
  g.circle(16, 1.5, 2.6).fill(0xf0f0f0);
  g.circle(16, 8.5, 2.6).fill(0xf0f0f0);
  root.addChild(g);
  return root;
}
