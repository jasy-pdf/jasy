// Generates a designed placeholder banner image (a real raster, committed as an asset) so the banner
// template can show the image layer without shipping a third-party photo. Run via render.sh's node.
import { Jimp } from "jimp";
import { mkdirSync } from "node:fs";

const W = 1400;
const H = 560;
const img = new Jimp({ width: W, height: H, color: 0x0a2348ff });

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const rgb = (r: number, g: number, b: number) =>
  clamp(r) * 16777216 + clamp(g) * 65536 + clamp(b) * 256 + 255;

// soft radial glow centre (upper-right), over a diagonal navy -> brand gradient
const cx = W * 0.72;
const cy = H * 0.32;
const maxD = Math.hypot(W, H);

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const t = (x / W) * 0.55 + (y / H) * 0.45; // diagonal ramp
    let r = lerp(0x0a, 0x1c, t);
    let g = lerp(0x23, 0x5e, t);
    let b = lerp(0x48, 0xc0, t);
    const glow = Math.max(0, 1 - Math.hypot(x - cx, y - cy) / (maxD * 0.42));
    r += glow * 40;
    g += glow * 55;
    b += glow * 70;
    img.setPixelColor(rgb(r, g, b), x, y);
  }
}

// a sparse dot field (deterministic), brighter near the glow - clearly a raster, not a vector fill
for (let gy = 0; gy < H; gy += 26) {
  for (let gx = 0; gx < W; gx += 26) {
    const glow = Math.max(0, 1 - Math.hypot(gx - cx, gy - cy) / (maxD * 0.5));
    const radius = 1 + Math.round(glow * 2);
    const a = 0.12 + glow * 0.5;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const px = gx + dx;
        const py = gy + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const cur = img.getPixelColor(px, py);
        const cr = (cur >>> 24) & 0xff;
        const cg = (cur >>> 16) & 0xff;
        const cb = (cur >>> 8) & 0xff;
        // blend toward accent yellow
        img.setPixelColor(rgb(lerp(cr, 0xf3, a), lerp(cg, 0xdc, a), lerp(cb, 0x29, a)), px, py);
      }
    }
  }
}

mkdirSync("examples/assets", { recursive: true });
await img.write("examples/assets/banner.png");
console.log(`wrote examples/assets/banner.png (${W}x${H})`);
