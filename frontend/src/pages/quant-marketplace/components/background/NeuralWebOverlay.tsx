import React, { useId } from "react";

export type NeuralWebVariant = "hero" | "gold" | "teal" | "subtle";

interface NeuralWebOverlayProps {
  variant?: NeuralWebVariant;
  className?: string;
}

const MASK_STYLES: Record<NeuralWebVariant, string> = {
  hero: "radial-gradient(ellipse 92% 88% at 72% 45%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 52%, rgba(0,0,0,0.22) 100%)",
  gold: "radial-gradient(ellipse 90% 85% at 88% 18%, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.45) 55%, rgba(0,0,0,0.18) 100%)",
  teal: "linear-gradient(135deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.22) 48%, rgba(0,0,0,0.8) 100%)",
  subtle:
    "radial-gradient(ellipse 100% 100% at 50% 50%, rgba(0,0,0,0.18) 25%, rgba(0,0,0,0.68) 78%, rgba(0,0,0,0.9) 100%)",
};

const OPACITY_CLASSES: Record<NeuralWebVariant, string> = {
  hero: "opacity-0 dark:opacity-75",
  gold: "opacity-0 dark:opacity-65",
  teal: "opacity-0 dark:opacity-55",
  subtle: "opacity-0 dark:opacity-50",
};

export const NeuralWebOverlay: React.FC<NeuralWebOverlayProps> = ({
  variant = "subtle",
  className = "",
}) => {
  const rawId = useId();
  const safeId = rawId.replace(/:/g, "");
  const patternId = `voltex-neural-web-${safeId}`;
  const glowFilterId = `voltex-neural-glow-${safeId}`;
  const lineGradId = `voltex-neural-grad-${safeId}`;

  const primaryStroke =
    variant === "gold" ? "#FCD34D" : variant === "teal" ? "#22D3EE" : "#38BDF8";
  const secondaryStroke =
    variant === "gold" ? "#22D3EE" : variant === "teal" ? "#FBBF24" : "#34D399";
  const tertiaryStroke = "#A78BFA";

  const maskValue = MASK_STYLES[variant];

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-0 overflow-hidden transition-opacity duration-300 ${OPACITY_CLASSES[variant]} ${className}`}
      style={{
        maskImage: maskValue,
        WebkitMaskImage: maskValue,
      }}
    >
      <svg
        className="w-full h-full block"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
      >
        <defs>
          {/* SVG luminescence filter for AI synaptic anchor nodes */}
          <filter
            id={glowFilterId}
            x="-40%"
            y="-40%"
            width="180%"
            height="180%"
          >
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation="1.8"
              result="blur"
            />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1.6 0"
              result="boostedBlur"
            />
            <feMerge>
              <feMergeNode in="boostedBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <linearGradient id={lineGradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={primaryStroke} stopOpacity="0.44" />
            <stop offset="50%" stopColor={secondaryStroke} stopOpacity="0.34" />
            <stop offset="100%" stopColor={tertiaryStroke} stopOpacity="0.40" />
          </linearGradient>

          {/* Seamless 180x180 triangulated AI neural web tile */}
          <pattern
            id={patternId}
            width="180"
            height="180"
            patternUnits="userSpaceOnUse"
          >
            {/* Primary triangulated digital web filaments (tile seamlessly at shared edge anchors) */}
            <g
              fill="none"
              stroke={`url(#${lineGradId})`}
              strokeWidth="0.65"
              strokeLinecap="round"
            >
              {/* Top & bottom shared anchors: (36, 0/180) and (126, 0/180) */}
              {/* Left & right shared anchors: (0/180, 48) and (0/180, 138) */}
              <path d="M36 0 L62 56 L126 0" />
              <path d="M0 48 L62 56 L94 98 L138 54 L180 48" />
              <path d="M0 48 L36 0 M126 0 L138 54 M138 54 L180 138" />
              <path d="M62 56 L138 54" />
              <path d="M62 56 L38 118 L94 98" />
              <path d="M0 138 L38 118 L36 180" />
              <path d="M38 118 L84 152 L94 98" />
              <path d="M94 98 L148 116 L138 54" />
              <path d="M148 116 L180 138" />
              <path d="M148 116 L126 180 L84 152 L36 180" />
              <path d="M0 138 L36 180 M126 180 L180 138" />
            </g>

            {/* Secondary dashed synaptic pathways */}
            <g
              fill="none"
              stroke={secondaryStroke}
              strokeOpacity="0.18"
              strokeWidth="0.5"
              strokeDasharray="2 4"
            >
              <line x1="62" y1="56" x2="148" y2="116" />
              <line x1="0" y1="48" x2="38" y2="118" />
              <line x1="126" y1="0" x2="94" y2="98" />
            </g>

            {/* Standard neural mesh vertices */}
            <g fill={tertiaryStroke} fillOpacity="0.45">
              <circle cx="36" cy="0" r="1.2" />
              <circle cx="36" cy="180" r="1.2" />
              <circle cx="126" cy="0" r="1.2" />
              <circle cx="126" cy="180" r="1.2" />
              <circle cx="0" cy="48" r="1.2" />
              <circle cx="180" cy="48" r="1.2" />
              <circle cx="0" cy="138" r="1.15" />
              <circle cx="180" cy="138" r="1.15" />
              <circle cx="38" cy="118" r="1.3" />
              <circle cx="84" cy="152" r="1.25" />
              <circle cx="148" cy="116" r="1.3" />
            </g>

            {/* Glowing AI core hubs with SVG filter */}
            <g filter={`url(#${glowFilterId})`}>
              <circle
                cx="62"
                cy="56"
                r="2.1"
                fill={primaryStroke}
                fillOpacity="0.82"
              />
              <circle
                cx="62"
                cy="56"
                r="5.2"
                fill="none"
                stroke={primaryStroke}
                strokeOpacity="0.28"
                strokeWidth="0.6"
              />

              <circle
                cx="138"
                cy="54"
                r="1.8"
                fill={secondaryStroke}
                fillOpacity="0.78"
              />
              <circle
                cx="94"
                cy="98"
                r="2.2"
                fill={secondaryStroke}
                fillOpacity="0.85"
              />
              <circle
                cx="94"
                cy="98"
                r="5.8"
                fill="none"
                stroke={secondaryStroke}
                strokeOpacity="0.26"
                strokeWidth="0.6"
              />
            </g>
          </pattern>
        </defs>

        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
};
