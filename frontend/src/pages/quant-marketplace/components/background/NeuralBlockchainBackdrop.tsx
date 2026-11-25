import React, { useEffect, useRef } from "react";
import type { ThemeMode } from "../hero/QuantHeroVisual";

interface NeuralNode {
  x: number;
  y: number;
  z: number; // Depth layer 0.35..1.0 for parallax & size
  vx: number;
  vy: number;
  pulsePhase: number;
  kind: "gold" | "teal" | "indigo";
}

interface SynapsePacket {
  from: number;
  to: number;
  t: number;
  speed: number;
  kind: "gold" | "teal";
}

export const NeuralBlockchainBackdrop: React.FC<{ theme: ThemeMode }> = ({
  theme,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const themeRef = useRef<ThemeMode>(theme);
  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let animId = 0;

    const count = Math.min(
      72,
      Math.max(38, Math.floor((width * height) / 24000)),
    );
    const nodes: NeuralNode[] = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      z: 0.4 + Math.random() * 0.6,
      vx: (Math.random() - 0.5) * 0.34,
      vy: (Math.random() - 0.5) * 0.34,
      pulsePhase: Math.random() * Math.PI * 2,
      kind: i % 6 === 0 ? "gold" : i % 2 === 0 ? "teal" : "indigo",
    }));

    const packets: SynapsePacket[] = [];
    const pointer = { x: width * 0.5, y: height * 0.35, active: false };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const onMove = (e: MouseEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    };
    window.addEventListener("mousemove", onMove, { passive: true });

    let time = 0;
    const maxDist = 210;

    let lastDraw = -Infinity;
    const render = () => {
      if (document.hidden) return;
      const now = performance.now();
      if (now - lastDraw < 50) {
        animId = requestAnimationFrame(render);
        return;
      }
      lastDraw = now;
      const isDark = themeRef.current === "dark";
      ctx.clearRect(0, 0, width, height);

      // Draw subtle flowing AI tensor waves across the canvas
      const waveCount = 4;
      for (let w = 0; w < waveCount; w++) {
        ctx.beginPath();
        const baseY = height * (0.18 + w * 0.22);
        const amp = 26 + w * 8;
        const freq = 0.0028 + w * 0.0007;
        for (let x = 0; x <= width; x += 28) {
          const y =
            baseY +
            Math.sin(x * freq + time * (0.4 + w * 0.12) + w) * amp +
            Math.cos(x * freq * 0.55 - time * 0.25) * 14;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = isDark
          ? w % 3 === 0
            ? "rgba(34, 211, 238, 0.16)"
            : w % 3 === 1
              ? "rgba(167, 139, 250, 0.14)"
              : "rgba(251, 191, 36, 0.12)"
          : w % 2 === 0
            ? "rgba(15, 118, 110, 0.06)"
            : "rgba(168, 124, 42, 0.05)";
        ctx.lineWidth = 1.25;
        ctx.stroke();
      }

      // Move nodes
      if (!prefersReduced) {
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          n.x += n.vx * n.z;
          n.y += n.vy * n.z;
          if (n.x < -30) n.x = width + 30;
          if (n.x > width + 30) n.x = -30;
          if (n.y < -30) n.y = height + 30;
          if (n.y > height + 30) n.y = -30;
        }
      }

      // Draw neural connections
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dSq = dx * dx + dy * dy;
          if (dSq < maxDist * maxDist) {
            const dist = Math.sqrt(dSq);
            const alpha = 1 - dist / maxDist;
            const isGold = a.kind === "gold" || b.kind === "gold";
            const isTeal = a.kind === "teal" || b.kind === "teal";

            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            if (isDark) {
              ctx.strokeStyle = isGold
                ? `rgba(252, 211, 77, ${(alpha * 0.42).toFixed(3)})`
                : isTeal
                  ? `rgba(34, 211, 238, ${(alpha * 0.38).toFixed(3)})`
                  : `rgba(167, 139, 250, ${(alpha * 0.32).toFixed(3)})`;
            } else {
              ctx.strokeStyle = isGold
                ? `rgba(168, 124, 42, ${(alpha * 0.18).toFixed(3)})`
                : `rgba(15, 118, 110, ${(alpha * 0.14).toFixed(3)})`;
            }
            ctx.lineWidth = alpha * 1.35;
            ctx.stroke();

            if (
              !prefersReduced &&
              packets.length < 22 &&
              Math.random() < 0.0028
            ) {
              packets.push({
                from: i,
                to: j,
                t: 0,
                speed: 0.014 + Math.random() * 0.018,
                kind: isGold ? "gold" : "teal",
              });
            }
          }
        }

        // Pointer neural attraction field
        if (pointer.active) {
          const pdx = a.x - pointer.x;
          const pdy = a.y - pointer.y;
          const pSq = pdx * pdx + pdy * pdy;
          if (pSq < 220 * 220) {
            const pAlpha = 1 - Math.sqrt(pSq) / 220;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(pointer.x, pointer.y);
            ctx.strokeStyle = isDark
              ? `rgba(45, 212, 191, ${(pAlpha * 0.32).toFixed(3)})`
              : `rgba(15, 118, 110, ${(pAlpha * 0.16).toFixed(3)})`;
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }
      }

      // Draw traveling synaptic signal pulses
      for (let k = packets.length - 1; k >= 0; k--) {
        const p = packets[k];
        p.t += p.speed;
        if (p.t >= 1) {
          packets.splice(k, 1);
          continue;
        }
        const a = nodes[p.from];
        const b = nodes[p.to];
        const px = a.x + (b.x - a.x) * p.t;
        const py = a.y + (b.y - a.y) * p.t;

        const halo = ctx.createRadialGradient(px, py, 0, px, py, 7);
        if (p.kind === "gold") {
          halo.addColorStop(
            0,
            isDark ? "rgba(245, 223, 176, 0.95)" : "rgba(180, 137, 56, 0.85)",
          );
          halo.addColorStop(1, "rgba(212, 175, 106, 0)");
        } else {
          halo.addColorStop(
            0,
            isDark ? "rgba(94, 234, 212, 0.95)" : "rgba(13, 148, 136, 0.85)",
          );
          halo.addColorStop(1, "rgba(45, 212, 191, 0)");
        }
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw AI neural nodes with soft volumetric glow halos
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const breathe = prefersReduced
          ? 1
          : 0.85 + 0.25 * Math.sin(time * 1.4 + n.pulsePhase);
        const r = (2.1 + n.z * 1.6) * breathe;

        if (isDark && (n.kind === "gold" || n.kind === "teal")) {
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 4.8);
          g.addColorStop(
            0,
            n.kind === "gold"
              ? "rgba(251, 191, 36, 0.52)"
              : "rgba(34, 211, 238, 0.48)",
          );
          g.addColorStop(1, "rgba(0, 0, 0, 0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 4.8, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isDark
          ? n.kind === "gold"
            ? "rgba(253, 224, 71, 0.94)"
            : n.kind === "teal"
              ? "rgba(103, 232, 249, 0.92)"
              : "rgba(196, 181, 253, 0.86)"
          : n.kind === "gold"
            ? "rgba(168, 124, 42, 0.55)"
            : "rgba(15, 118, 110, 0.45)";
        ctx.fill();
      }

      if (!prefersReduced) {
        time += 0.018;
        animId = requestAnimationFrame(render);
      }
    };

    function resume() {
      cancelAnimationFrame(animId);
      if (!document.hidden) render();
    }
    document.addEventListener("visibilitychange", resume);
    render();

    return () => {
      document.removeEventListener("visibilitychange", resume);
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* Multi-layered AI intelligence volumetric nebula & midnight indigo/teal atmosphere */}
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{
          background:
            theme === "dark"
              ? [
                  "radial-gradient(ellipse 68% 54% at 14% 12%, rgba(99, 102, 241, 0.52) 0%, rgba(168, 85, 247, 0.22) 38%, transparent 66%)",
                  "radial-gradient(ellipse 62% 50% at 86% 16%, rgba(6, 182, 212, 0.48) 0%, rgba(20, 184, 166, 0.24) 40%, transparent 64%)",
                  "radial-gradient(ellipse 56% 46% at 56% 52%, rgba(139, 92, 246, 0.32) 0%, transparent 65%)",
                  "radial-gradient(ellipse 58% 48% at 78% 82%, rgba(245, 158, 11, 0.26) 0%, transparent 64%)",
                  "radial-gradient(ellipse 60% 50% at 20% 84%, rgba(56, 189, 248, 0.28) 0%, transparent 65%)",
                  "linear-gradient(150deg, #070B1B 0%, #12193B 46%, #09182E 100%)",
                ].join(", ")
              : "radial-gradient(ellipse 80% 55% at 18% 8%, rgba(212, 175, 106, 0.10) 0%, transparent 65%), linear-gradient(160deg, #FAF9F6 0%, #F4F2EC 100%)",
        }}
      />

      {/* Fine AI coordinate lattice */}
      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.28]"
        style={{
          backgroundImage:
            theme === "dark"
              ? "radial-gradient(rgba(148, 163, 184, 0.16) 1px, transparent 1px), linear-gradient(to right, rgba(45, 212, 191, 0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(45, 212, 191, 0.05) 1px, transparent 1px)"
              : "linear-gradient(to right, rgba(15, 23, 42, 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(15, 23, 42, 0.04) 1px, transparent 1px)",
          backgroundSize:
            theme === "dark" ? "32px 32px, 96px 96px, 96px 96px" : "64px 64px",
        }}
      />

      {/* Interactive AI Synaptic Web & Tensor Filaments Canvas */}
      <canvas
        ref={canvasRef}
        className="qx-backdrop-web absolute inset-0 w-full h-full block"
      />
    </div>
  );
};
