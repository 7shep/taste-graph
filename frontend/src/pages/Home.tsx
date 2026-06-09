import { useEffect, useRef } from "react";
import { useSpotifyAuth } from "../hooks/useSpotifyAuth";
import { readSpotifyAuthSession } from "../lib/auth";

const COLORS = ["#ef8a6b", "#e9bd5a", "#7fd4a8", "#9aa9ee", "#c79df0"];

interface ClusterBias {
  cx: number;
  cy: number;
  cz: number;
  color: number;
  weight: number;
}

// each cluster occupies a hemisphere region — bias spawn within
const CLUSTER_BIAS: ClusterBias[] = [
  { cx: -0.6, cy: -0.4, cz: 0.3, color: 0, weight: 1.0 },
  { cx: 0.6, cy: -0.4, cz: 0.3, color: 1, weight: 0.9 },
  { cx: -0.5, cy: 0.5, cz: -0.2, color: 2, weight: 0.9 },
  { cx: 0.6, cy: 0.5, cz: 0.0, color: 3, weight: 1.0 },
  { cx: 0.0, cy: 0.0, cz: 0.6, color: 4, weight: 0.6 }, // bridge cluster, center-front
];

interface ConstellationNode {
  x: number;
  y: number;
  z: number;
  cluster: ClusterBias;
  color: string;
  size: number;
  phase: number;
}

interface ConstellationEdge {
  a: number;
  b: number;
  w: number;
  cross: boolean;
}

// spherical fibonacci-ish point distribution, jittered inside cluster bias
function makeNodes(count: number): ConstellationNode[] {
  const nodes: ConstellationNode[] = [];
  const totalWeight = CLUSTER_BIAS.reduce((sum, c) => sum + c.weight, 0);
  for (let i = 0; i < count; i++) {
    let r = Math.random() * totalWeight;
    let cluster = CLUSTER_BIAS[0];
    for (const c of CLUSTER_BIAS) {
      r -= c.weight;
      if (r <= 0) {
        cluster = c;
        break;
      }
    }

    // jitter around cluster center on the unit sphere
    const theta = Math.random() * Math.PI * 2;
    const spread = 0.55 + Math.random() * 0.35;
    let x =
      cluster.cx + Math.cos(theta) * spread * 0.5 * (0.4 + Math.random() * 0.6);
    let y =
      cluster.cy + Math.sin(theta) * spread * 0.5 * (0.4 + Math.random() * 0.6);
    let z = cluster.cz + (Math.random() - 0.5) * 0.5;
    const m = Math.hypot(x, y, z) || 1;
    x /= m;
    y /= m;
    z /= m;

    nodes.push({
      x,
      y,
      z,
      cluster,
      color: COLORS[cluster.color],
      size:
        Math.random() < 0.08
          ? 3.2 + Math.random() * 1.6
          : 1.0 + Math.random() * 1.3,
      phase: Math.random() * Math.PI * 2,
    });
  }
  return nodes;
}

// connect close-by nodes (great-circle proximity)
function makeEdges(nodes: ConstellationNode[]): ConstellationEdge[] {
  const edges: ConstellationEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    let count = 0;
    for (let j = i + 1; j < nodes.length; j++) {
      const dot =
        nodes[i].x * nodes[j].x +
        nodes[i].y * nodes[j].y +
        nodes[i].z * nodes[j].z;
      const sameCluster = nodes[i].cluster === nodes[j].cluster;
      const threshold = sameCluster ? 0.86 : 0.94;
      if (dot > threshold) {
        edges.push({
          a: i,
          b: j,
          w: (dot - threshold) / (1 - threshold),
          cross: !sameCluster,
        });
        count++;
        if (count > 4) break;
      }
    }
  }
  return edges;
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function useConstellation(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const DPR = Math.max(1, window.devicePixelRatio || 1);
    let W = 0;
    let H = 0;
    let CX = 0;
    let CY = 0;

    function size() {
      if (!canvas || !ctx) return;
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      CX = W / 2;
      CY = H / 2;
    }
    size();

    const nodes = makeNodes(170);
    const edges = makeEdges(nodes);

    const cam = {
      yaw: 0,
      pitch: 0.2,
      yawV: 0.0015,
      targetYaw: 0,
      targetPitch: 0.2,
      drag: false,
      lastX: 0,
      lastY: 0,
    };
    const radius = () => Math.min(W, H) * 0.42;

    function project(p: { x: number; y: number; z: number }) {
      // rotate yaw (Y axis) then pitch (X axis)
      const cy = Math.cos(cam.yaw);
      const sy = Math.sin(cam.yaw);
      const cp = Math.cos(cam.pitch);
      const sp = Math.sin(cam.pitch);
      const x = p.x * cy + p.z * sy;
      const z = -p.x * sy + p.z * cy;
      const y = p.y;
      const y2 = y * cp - z * sp;
      const z2 = y * sp + z * cp;
      // perspective
      const fov = 1.3;
      const dist = 2.6;
      const scale = fov / (dist - z2);
      const R = radius();
      return {
        sx: CX + x * R * scale,
        sy: CY + y2 * R * scale,
        sz: z2,
        scale,
      };
    }

    const onMouseMove = (e: MouseEvent) => {
      if (cam.drag) {
        cam.targetYaw += (e.clientX - cam.lastX) * 0.004;
        cam.targetPitch += (e.clientY - cam.lastY) * 0.003;
        cam.lastX = e.clientX;
        cam.lastY = e.clientY;
        return;
      }
      cam.targetYaw = (e.clientX / W - 0.5) * 0.6;
      cam.targetPitch = 0.2 + (e.clientY / H - 0.5) * 0.4;
    };
    const onMouseDown = (e: MouseEvent) => {
      cam.drag = true;
      cam.lastX = e.clientX;
      cam.lastY = e.clientY;
    };
    const onMouseUp = () => {
      cam.drag = false;
    };

    window.addEventListener("resize", size);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);

    let rafId = 0;
    const t0 = performance.now();

    function frame() {
      if (!ctx) return;
      const t = (performance.now() - t0) * 0.001;

      // auto-rotate, gently biased toward the mouse target
      cam.yaw += cam.yawV;
      cam.pitch += Math.sin(t * 0.3) * 0.0002;
      cam.yaw = cam.yaw * 0.998 + (cam.targetYaw + t * 0.05) * 0.002;
      cam.pitch = cam.pitch * 0.985 + cam.targetPitch * 0.015;

      ctx.clearRect(0, 0, W, H);

      const proj = nodes.map((n) => {
        // breathe each node along its normal slightly
        const breathe = 1 + Math.sin(t * 0.6 + n.phase) * 0.015;
        const p = project({
          x: n.x * breathe,
          y: n.y * breathe,
          z: n.z * breathe,
        });
        return { ...p, n };
      });

      // edges first, sorted back-to-front by midpoint z
      const edgesSorted = edges
        .map((e) => ({
          e,
          A: proj[e.a],
          B: proj[e.b],
          midZ: (proj[e.a].sz + proj[e.b].sz) / 2,
        }))
        .sort((u, v) => u.midZ - v.midZ);

      for (const { e, A, B } of edgesSorted) {
        const depth = ((A.sz + B.sz) / 2 + 1) / 2; // 0..1
        const baseA = e.cross ? 0.08 : 0.16;
        const alpha = baseA * (0.3 + depth * 0.9) * (0.5 + e.w * 0.7);
        if (alpha < 0.012) continue;
        const grad = ctx.createLinearGradient(A.sx, A.sy, B.sx, B.sy);
        grad.addColorStop(0, hexA(nodes[e.a].color, alpha));
        grad.addColorStop(1, hexA(nodes[e.b].color, alpha));
        ctx.strokeStyle = grad;
        ctx.lineWidth = e.cross ? 0.5 : 0.6 + e.w * 0.6;
        ctx.setLineDash(e.cross ? [3, 3] : []);
        ctx.beginPath();
        ctx.moveTo(A.sx, A.sy);
        ctx.lineTo(B.sx, B.sy);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // nodes back-to-front
      const nodesSorted = proj.slice().sort((u, v) => u.sz - v.sz);
      for (const p of nodesSorted) {
        const depth = (p.sz + 1) / 2;
        const r = p.n.size * (0.6 + depth * 1.4) * p.scale * 2.8;
        const alpha = 0.25 + depth * 0.75;
        // glow
        const glow = ctx.createRadialGradient(
          p.sx,
          p.sy,
          0,
          p.sx,
          p.sy,
          r * 4.5,
        );
        glow.addColorStop(0, hexA(p.n.color, 0.55 * alpha));
        glow.addColorStop(1, hexA(p.n.color, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r * 4.5, 0, Math.PI * 2);
        ctx.fill();
        // core
        ctx.fillStyle = hexA(p.n.color, alpha);
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fill();
        // highlight
        ctx.fillStyle = `rgba(255,255,255,${0.45 * alpha})`;
        ctx.beginPath();
        ctx.arc(p.sx - r * 0.3, p.sy - r * 0.3, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", size);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [canvasRef]);
}

function BrandMark() {
  return (
    <svg
      className="tg-landing-brand-mark"
      viewBox="0 0 22 22"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="3.5" fill="#ef8a6b" />
      <circle cx="16" cy="7" r="2.5" fill="#e9bd5a" />
      <circle cx="7" cy="16" r="2.5" fill="#7fd4a8" />
      <circle cx="15.5" cy="15.5" r="3" fill="#9aa9ee" />
      <path
        d="M6 6 L16 7 M6 6 L7 16 M16 7 L15.5 15.5 M7 16 L15.5 15.5"
        stroke="#f4ede3"
        strokeOpacity="0.35"
        strokeWidth="0.8"
      />
    </svg>
  );
}

export default function HomePage() {
  const { beginLogin, error, isLoading } = useSpotifyAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useConstellation(canvasRef);

  useEffect(() => {
    if (readSpotifyAuthSession()) {
      window.location.replace("/graph");
    }
  }, []);

  return (
    <div className="tg-landing">
      <canvas ref={canvasRef} className="tg-landing-stage" />

      <header className="tg-landing-top">
        <div className="tg-landing-brand">
          <BrandMark />
          <span>
            Taste<em>Graph</em>
          </span>
        </div>
        <div className="tg-landing-top-meta">
          <span className="tg-landing-dot" />
          <span>v 0.4 · private beta</span>
        </div>
      </header>

      {/* floating annotations */}
      <div className="tg-landing-annot tg-landing-a-1">
        <div className="tg-landing-annot-text">
          <span className="tg-landing-tag">cluster · 04</span>
          East Coast
          <br />
          neighborhood
        </div>
      </div>
      <div className="tg-landing-annot tg-landing-a-2">
        <div className="tg-landing-annot-text">
          <span className="tg-landing-tag">bridge · 17</span>
          Baby Keem
          <br />
          <em className="tg-landing-bridge-em">crosses three clusters</em>
        </div>
      </div>
      <div className="tg-landing-annot tg-landing-a-3">
        <div className="tg-landing-annot-text">
          <span className="tg-landing-tag">connection · 0.84</span>
          Kendrick ↔ SZA
        </div>
      </div>
      <div className="tg-landing-annot tg-landing-a-4">
        <div className="tg-landing-annot-text">
          <span className="tg-landing-tag">discovery · last week</span>
          found Smino via JID
        </div>
      </div>

      <section className="tg-landing-hero">
        <div className="tg-landing-eyebrow">
          <span>A new way to see your music</span>
        </div>

        <h1 className="tg-landing-title">
          Taste
          <br />
          <em>Graph</em>
        </h1>

        <p className="tg-landing-sub">
          Every artist you love, every connection between them — drawn from your
          listening, alive in three dimensions.
        </p>

        <div className="tg-landing-cta-wrap">
          <button
            type="button"
            className="tg-landing-cta"
            disabled={isLoading}
            onClick={() => void beginLogin()}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="#04130a"
              aria-hidden="true"
            >
              <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm5.5 17.3a.75.75 0 0 1-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 1 1-.33-1.46c4.57-1.04 8.5-.59 11.66 1.34.36.22.47.69.25 1.03zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.23-1.99-8.16-2.56-11.98-1.4a.94.94 0 1 1-.55-1.8c4.38-1.33 9.82-.69 13.52 1.59.44.27.58.85.3 1.3zm.13-3.4c-3.87-2.3-10.27-2.51-13.96-1.39a1.13 1.13 0 1 1-.66-2.16c4.25-1.29 11.31-1.04 15.77 1.6a1.13 1.13 0 1 1-1.15 1.95z" />
            </svg>
            <span>{isLoading ? "Connecting…" : "Login with Spotify"}</span>
            <svg
              className="tg-landing-cta-arrow"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="#04130a"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 7h10M8 3l4 4-4 4" />
            </svg>
          </button>
          <div className="tg-landing-fineprint">
            We read · we never post · <a href="#">privacy</a>
          </div>
          {error ? (
            <p className="tg-landing-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </section>

      <div className="tg-landing-hint">drag to rotate</div>

      <footer className="tg-landing-foot">
        <div>
          <strong>made from listening</strong>
          <br />
          <span className="tg-landing-foot-dim">your data stays yours</span>
        </div>
        <div className="tg-landing-foot-r">
          <strong>sim · t 00:42</strong>
          <br />
          <span className="tg-landing-foot-dim">214 nodes · 612 edges</span>
        </div>
      </footer>
    </div>
  );
}
