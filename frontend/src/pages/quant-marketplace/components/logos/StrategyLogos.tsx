import { visuals } from "../../data/visuals";
import React from "react";

export const VoltexEmblem: React.FC<{ className?: string }> = ({
  className = "w-6 h-6",
}) => (
  <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
    <defs>
      <linearGradient
        id="voltexGold"
        x1="2"
        y1="2"
        x2="30"
        y2="30"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0%" stopColor="#F5DFB0" />
        <stop offset="50%" stopColor="#D4AF6A" />
        <stop offset="100%" stopColor="#9A7839" />
      </linearGradient>
    </defs>
    <path
      d="M4.5 6.5L16 26.5L27.5 6.5H21.8L16 17.2L10.2 6.5H4.5Z"
      fill="url(#voltexGold)"
    />
    <path
      d="M12.8 6.5L16 12.2L19.2 6.5H12.8Z"
      fill="currentColor"
      fillOpacity="0.88"
    />
  </svg>
);

export const StrategyLogo: React.FC<{
  customLogo?: string | null;
  strategyId: string;
  size?: number;
  className?: string;
}> = ({ strategyId, customLogo, size = 40, className = "" }) => {
  if (customLogo?.startsWith("data:image/webp;base64,"))
    return (
      <img
        src={customLogo}
        width={size}
        height={size}
        alt=""
        className={className}
      />
    );
  switch (visuals[strategyId as keyof typeof visuals]?.logo ?? strategyId) {
    case "thomas-quant-ai":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          className={className}
          aria-label="Thomas Quant AI логотип"
        >
          <defs>
            <linearGradient
              id="tqBg"
              x1="0"
              y1="0"
              x2="48"
              y2="48"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#161922" />
              <stop offset="100%" stopColor="#0B0D12" />
            </linearGradient>
            <linearGradient
              id="tqGold"
              x1="8"
              y1="8"
              x2="40"
              y2="40"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#F6E3B9" />
              <stop offset="50%" stopColor="#D4AF6A" />
              <stop offset="100%" stopColor="#9B7738" />
            </linearGradient>
            <linearGradient
              id="tqTurquoise"
              x1="12"
              y1="38"
              x2="38"
              y2="12"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#14B8A6" />
              <stop offset="100%" stopColor="#5EEAD4" />
            </linearGradient>
          </defs>
          <rect
            x="1"
            y="1"
            width="46"
            height="46"
            rx="10"
            fill="url(#tqBg)"
            stroke="url(#tqGold)"
            strokeWidth="1.25"
          />
          {/* Outer octagonal neural frame */}
          <polygon
            points="24,6 37,12 42,24 37,36 24,42 11,36 6,24 11,12"
            stroke="#D4AF6A"
            strokeOpacity="0.24"
            strokeWidth="0.9"
          />
          {/* Neural lattice connections */}
          <path
            d="M11 16L24 12L37 16M11 32L24 36L37 32M11 16L11 32M37 16L37 32"
            stroke="url(#tqTurquoise)"
            strokeOpacity="0.45"
            strokeWidth="0.9"
          />
          {/* Stylized TQ Monogram */}
          <path
            d="M14 15.5H31.5M22.75 15.5V33"
            stroke="url(#tqGold)"
            strokeWidth="2.6"
            strokeLinecap="square"
          />
          <circle
            cx="29.5"
            cy="27.5"
            r="5.5"
            stroke="url(#tqTurquoise)"
            strokeWidth="2.1"
          />
          <path
            d="M33.2 31.2L36.5 34.5"
            stroke="url(#tqTurquoise)"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
          {/* Neural nodes */}
          <circle cx="14" cy="15.5" r="1.6" fill="#5EEAD4" />
          <circle cx="31.5" cy="15.5" r="1.6" fill="#F6E3B9" />
          <circle cx="22.75" cy="33" r="1.6" fill="#F6E3B9" />
          <circle cx="11" cy="24" r="1.2" fill="#2DD4BF" fillOpacity="0.7" />
          <circle cx="37" cy="24" r="1.2" fill="#D4AF6A" fillOpacity="0.7" />
        </svg>
      );

    case "atlas-grid":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          className={className}
          aria-label="Atlas Grid логотип"
        >
          <rect
            x="1"
            y="1"
            width="46"
            height="46"
            rx="10"
            fill="#0F141D"
            stroke="#38BDF8"
            strokeOpacity="0.35"
            strokeWidth="1.2"
          />
          {/* Structured geometric grid planes */}
          <path
            d="M12 16H36M12 24H36M12 32H36M16 12V36M24 12V36M32 12V36"
            stroke="#38BDF8"
            strokeOpacity="0.32"
            strokeWidth="1"
          />
          <path
            d="M16 32L24 24L32 16"
            stroke="#BAE6FD"
            strokeWidth="2.2"
            strokeLinecap="square"
          />
          <rect x="14" y="30" width="4" height="4" fill="#38BDF8" />
          <rect x="22" y="22" width="4" height="4" fill="#E0F2FE" />
          <rect x="30" y="14" width="4" height="4" fill="#38BDF8" />
          <rect
            x="22"
            y="14"
            width="4"
            height="4"
            stroke="#38BDF8"
            strokeOpacity="0.7"
            strokeWidth="1.2"
          />
          <rect
            x="14"
            y="22"
            width="4"
            height="4"
            stroke="#38BDF8"
            strokeOpacity="0.7"
            strokeWidth="1.2"
          />
        </svg>
      );

    case "ether-dca":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          className={className}
          aria-label="Ether DCA логотип"
        >
          <defs>
            <linearGradient
              id="ethGrad"
              x1="12"
              y1="8"
              x2="36"
              y2="40"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#A5B4FC" />
              <stop offset="100%" stopColor="#2DD4BF" />
            </linearGradient>
          </defs>
          <rect
            x="1"
            y="1"
            width="46"
            height="46"
            rx="10"
            fill="#10121C"
            stroke="#818CF8"
            strokeOpacity="0.38"
            strokeWidth="1.2"
          />
          {/* Layered accumulation diamond prism */}
          <polygon
            points="24,8 35,23 24,29 13,23"
            stroke="url(#ethGrad)"
            strokeWidth="1.7"
            fill="#818CF8"
            fillOpacity="0.12"
          />
          <polygon
            points="24,13 31,22.5 24,26.5 17,22.5"
            stroke="#2DD4BF"
            strokeOpacity="0.65"
            strokeWidth="1.1"
          />
          <path
            d="M13 26.5L24 33L35 26.5"
            stroke="#818CF8"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M15 31.5L24 38L33 31.5"
            stroke="#2DD4BF"
            strokeOpacity="0.85"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="24"
            y1="8"
            x2="24"
            y2="29"
            stroke="#C7D2FE"
            strokeOpacity="0.45"
            strokeWidth="1"
          />
        </svg>
      );

    case "sol-momentum":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          className={className}
          aria-label="SOL Momentum логотип"
        >
          <defs>
            <linearGradient
              id="solGrad"
              x1="10"
              y1="36"
              x2="38"
              y2="12"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#059669" />
              <stop offset="100%" stopColor="#6EE7B7" />
            </linearGradient>
          </defs>
          <rect
            x="1"
            y="1"
            width="46"
            height="46"
            rx="10"
            fill="#0B1512"
            stroke="#10B981"
            strokeOpacity="0.4"
            strokeWidth="1.2"
          />
          {/* Energetic parallel velocity vectors */}
          <path
            d="M11 31L18 24H37L30 31H11Z"
            fill="url(#solGrad)"
            fillOpacity="0.25"
            stroke="#34D399"
            strokeWidth="1.4"
          />
          <path
            d="M11 22L18 15H37L30 22H11Z"
            fill="url(#solGrad)"
            fillOpacity="0.85"
          />
          <path
            d="M27 11L37 11L37 21"
            stroke="#A7F3D0"
            strokeWidth="1.8"
            strokeLinecap="square"
          />
          <line
            x1="11"
            y1="36"
            x2="29"
            y2="36"
            stroke="#10B981"
            strokeOpacity="0.6"
            strokeWidth="1.8"
          />
        </svg>
      );

    case "delta-balance":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          className={className}
          aria-label="Delta Balance логотип"
        >
          <rect
            x="1"
            y="1"
            width="46"
            height="46"
            rx="10"
            fill="#101318"
            stroke="#94A3B8"
            strokeOpacity="0.4"
            strokeWidth="1.2"
          />
          {/* Mathematical delta symmetry + fulcrum line */}
          <line
            x1="9"
            y1="24"
            x2="39"
            y2="24"
            stroke="#34D399"
            strokeOpacity="0.55"
            strokeWidth="1.2"
            strokeDasharray="2 2"
          />
          <polygon
            points="24,10 35,28 13,28"
            stroke="#E2E8F0"
            strokeWidth="1.9"
            fill="#94A3B8"
            fillOpacity="0.12"
          />
          <polygon
            points="24,38 31,26 17,26"
            stroke="#34D399"
            strokeWidth="1.6"
            fill="#34D399"
            fillOpacity="0.15"
          />
          <circle cx="24" cy="24" r="2.2" fill="#F8FAFC" />
        </svg>
      );

    case "smart-rebalance":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          className={className}
          aria-label="Smart Rebalance логотип"
        >
          <rect
            x="1"
            y="1"
            width="46"
            height="46"
            rx="10"
            fill="#0B1416"
            stroke="#14B8A6"
            strokeOpacity="0.38"
            strokeWidth="1.2"
          />
          {/* Interconnected orbital portfolio nodes */}
          <circle
            cx="24"
            cy="24"
            r="11"
            stroke="#14B8A6"
            strokeOpacity="0.35"
            strokeWidth="1.2"
          />
          <path
            d="M24 13L33.5 29.5H14.5L24 13Z"
            stroke="#5EEAD4"
            strokeOpacity="0.7"
            strokeWidth="1.3"
          />
          <line
            x1="24"
            y1="24"
            x2="24"
            y2="13"
            stroke="#99F6E4"
            strokeWidth="1.3"
          />
          <line
            x1="24"
            y1="24"
            x2="33.5"
            y2="29.5"
            stroke="#99F6E4"
            strokeWidth="1.3"
          />
          <line
            x1="24"
            y1="24"
            x2="14.5"
            y2="29.5"
            stroke="#99F6E4"
            strokeWidth="1.3"
          />
          <circle
            cx="24"
            cy="13"
            r="3"
            fill="#14B8A6"
            stroke="#0B1416"
            strokeWidth="1.2"
          />
          <circle
            cx="33.5"
            cy="29.5"
            r="3"
            fill="#5EEAD4"
            stroke="#0B1416"
            strokeWidth="1.2"
          />
          <circle
            cx="14.5"
            cy="29.5"
            r="3"
            fill="#2DD4BF"
            stroke="#0B1416"
            strokeWidth="1.2"
          />
          <circle cx="24" cy="24" r="2.5" fill="#F0FDFA" />
        </svg>
      );

    case "breakout-pro":
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          className={className}
          aria-label="Breakout Pro логотип"
        >
          <rect
            x="1"
            y="1"
            width="46"
            height="46"
            rx="10"
            fill="#16120B"
            stroke="#F59E0B"
            strokeOpacity="0.4"
            strokeWidth="1.2"
          />
          {/* Resistance horizon + explosive directional breach */}
          <line
            x1="9"
            y1="24"
            x2="39"
            y2="24"
            stroke="#F59E0B"
            strokeOpacity="0.45"
            strokeWidth="1.3"
            strokeDasharray="3 2"
          />
          <line
            x1="9"
            y1="31"
            x2="39"
            y2="31"
            stroke="#F59E0B"
            strokeOpacity="0.2"
            strokeWidth="1"
          />
          <path
            d="M11 33L18 27L22 29L33 13"
            stroke="#FBBF24"
            strokeWidth="2.4"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
          <path
            d="M25 13H33V21"
            stroke="#FDE68A"
            strokeWidth="2.2"
            strokeLinecap="square"
          />
          <circle cx="23.5" cy="24" r="2.3" fill="#F59E0B" />
        </svg>
      );

    default:
      return (
        <svg
          width={size}
          height={size}
          viewBox="0 0 48 48"
          fill="none"
          className={className}
        >
          <rect
            x="1"
            y="1"
            width="46"
            height="46"
            rx="10"
            fill="#12151C"
            stroke="#D4AF6A"
            strokeOpacity="0.4"
            strokeWidth="1.2"
          />
          <polygon
            points="24,10 36,24 24,38 12,24"
            stroke="#D4AF6A"
            strokeWidth="1.8"
          />
          <circle cx="24" cy="24" r="3" fill="#2DD4BF" />
        </svg>
      );
  }
};

export const AcademyIllustration: React.FC<{
  type: "algorithmic" | "quant-risk" | "selection";
}> = ({ type }) => {
  if (type === "algorithmic") {
    return (
      <svg viewBox="0 0 360 170" fill="none" className="w-full h-full">
        <defs>
          <linearGradient
            id="acBg1"
            x1="0"
            y1="0"
            x2="360"
            y2="170"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#12161F" />
            <stop offset="100%" stopColor="#0B0D13" />
          </linearGradient>
          <linearGradient
            id="acGold1"
            x1="40"
            y1="20"
            x2="310"
            y2="140"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#E5C98B" />
            <stop offset="100%" stopColor="#2DD4BF" />
          </linearGradient>
        </defs>
        <rect width="360" height="170" fill="url(#acBg1)" />
        {/* Architectural coordinate grid */}
        <path
          d="M0 42H360M0 85H360M0 128H360M90 0V170M180 0V170M270 0V170"
          stroke="#FFFFFF"
          strokeOpacity="0.04"
        />
        {/* Multi-layer order book & algorithmic wave */}
        <rect
          x="44"
          y="42"
          width="76"
          height="86"
          rx="6"
          fill="#171C26"
          stroke="#D4AF6A"
          strokeOpacity="0.28"
        />
        <line
          x1="56"
          y1="62"
          x2="106"
          y2="62"
          stroke="#D4AF6A"
          strokeOpacity="0.6"
          strokeWidth="2"
        />
        <line
          x1="56"
          y1="76"
          x2="96"
          y2="76"
          stroke="#2DD4BF"
          strokeOpacity="0.7"
          strokeWidth="2"
        />
        <line
          x1="56"
          y1="90"
          x2="108"
          y2="90"
          stroke="#94A3B8"
          strokeOpacity="0.4"
          strokeWidth="2"
        />
        <line
          x1="56"
          y1="104"
          x2="88"
          y2="104"
          stroke="#D4AF6A"
          strokeOpacity="0.4"
          strokeWidth="2"
        />

        <path
          d="M120 85H158"
          stroke="#D4AF6A"
          strokeOpacity="0.45"
          strokeDasharray="3 3"
        />
        <polygon
          points="180,44 218,85 180,126 142,85"
          fill="#161B25"
          stroke="url(#acGold1)"
          strokeWidth="1.5"
        />
        <polygon
          points="180,58 204,85 180,112 156,85"
          stroke="#2DD4BF"
          strokeOpacity="0.5"
          strokeWidth="1"
        />
        <circle cx="180" cy="85" r="4" fill="#E5C98B" />

        <path
          d="M218 85H244"
          stroke="#2DD4BF"
          strokeOpacity="0.5"
          strokeDasharray="3 3"
        />
        <path
          d="M246 116L266 94L284 102L316 54"
          stroke="url(#acGold1)"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="316" cy="54" r="4" fill="#2DD4BF" />
        <circle cx="266" cy="94" r="2.5" fill="#D4AF6A" />
      </svg>
    );
  }

  if (type === "quant-risk") {
    return (
      <svg viewBox="0 0 360 170" fill="none" className="w-full h-full">
        <rect width="360" height="170" fill="#0E121A" />
        <path
          d="M0 42H360M0 85H360M0 128H360M90 0V170M180 0V170M270 0V170"
          stroke="#FFFFFF"
          strokeOpacity="0.04"
        />
        {/* Normal / tail risk distribution curve */}
        <path
          d="M36 132C78 132 104 126 130 94C152 66 164 38 180 38C196 38 208 66 230 94C256 126 282 132 324 132"
          stroke="#2DD4BF"
          strokeWidth="2.2"
          fill="#2DD4BF"
          fillOpacity="0.08"
        />
        {/* VaR / Drawdown threshold lines */}
        <line
          x1="112"
          y1="30"
          x2="112"
          y2="140"
          stroke="#EF4444"
          strokeOpacity="0.55"
          strokeDasharray="3 3"
        />
        <line
          x1="248"
          y1="30"
          x2="248"
          y2="140"
          stroke="#D4AF6A"
          strokeOpacity="0.55"
          strokeDasharray="3 3"
        />
        <line
          x1="180"
          y1="24"
          x2="180"
          y2="142"
          stroke="#E5C98B"
          strokeOpacity="0.3"
        />
        <rect
          x="112"
          y="106"
          width="136"
          height="26"
          fill="#D4AF6A"
          fillOpacity="0.08"
        />
        <circle cx="180" cy="38" r="3.5" fill="#E5C98B" />
        <circle cx="112" cy="112" r="3" fill="#EF4444" />
        <circle cx="248" cy="112" r="3" fill="#2DD4BF" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 360 170" fill="none" className="w-full h-full">
      <rect width="360" height="170" fill="#0F1218" />
      <path
        d="M0 42H360M0 85H360M0 128H360M90 0V170M180 0V170M270 0V170"
        stroke="#FFFFFF"
        strokeOpacity="0.04"
      />
      {/* Risk-return frontier radar & comparative matrix */}
      <circle cx="115" cy="85" r="46" stroke="#D4AF6A" strokeOpacity="0.22" />
      <circle cx="115" cy="85" r="28" stroke="#2DD4BF" strokeOpacity="0.28" />
      <polygon
        points="115,44 152,78 134,122 86,114 78,66"
        fill="#D4AF6A"
        fillOpacity="0.14"
        stroke="#E5C98B"
        strokeWidth="1.5"
      />
      <circle cx="115" cy="85" r="3" fill="#2DD4BF" />
      {/* Selection comparison bars */}
      <rect
        x="200"
        y="44"
        width="118"
        height="22"
        rx="4"
        fill="#171C26"
        stroke="#D4AF6A"
        strokeOpacity="0.4"
      />
      <rect x="206" y="51" width="76" height="8" rx="2" fill="#D4AF6A" />
      <rect
        x="200"
        y="74"
        width="118"
        height="22"
        rx="4"
        fill="#171C26"
        stroke="#FFFFFF"
        strokeOpacity="0.1"
      />
      <rect x="206" y="81" width="54" height="8" rx="2" fill="#2DD4BF" />
      <rect
        x="200"
        y="104"
        width="118"
        height="22"
        rx="4"
        fill="#171C26"
        stroke="#FFFFFF"
        strokeOpacity="0.1"
      />
      <rect x="206" y="111" width="92" height="8" rx="2" fill="#38BDF8" />
    </svg>
  );
};
