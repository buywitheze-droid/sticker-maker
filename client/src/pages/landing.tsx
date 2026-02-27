import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ALL_PROFILES, type ProfileConfig } from "@/lib/profiles";
import { IconHotPeel, IconFluorescent, IconUvDtf, IconSpecialtyColdPeel } from "@/components/profile-icons";

type CardContent = {
  subline: string;
  bullets: string[];
  pressSettings: string;
  ctaLabel: string;
};

const CARD_CONTENT: Record<string, CardContent> = {
  "hot-peel": {
    subline: "Fast-peel transfers with bold color and strong stretch.",
    bullets: [
      "Works great on light + dark garments",
      "Smooth feel, high detail",
      "Ideal for quick production",
    ],
    pressSettings: "275°F • 15s • peel hot or warm • repress 5–10s",
    ctaLabel: "Open Builder",
  },
  fluorescent: {
    subline: "UV-reactive prints that glow under blacklight.",
    bullets: [
      "Select the color(s) in your art to print as fluorescent",
      "Perfect for events, nightlife, promos",
      "High pop under UV light",
    ],
    pressSettings: "Coming soon — get notified at launch",
    ctaLabel: "Open Builder",
  },
  "uv-dtf": {
    subline: "Durable decals for hard surfaces — no heat press needed.",
    bullets: [
      "Applies to acrylic, plastic, glass, metal",
      "Strong adhesive + sharp detail",
      "Not dishwasher safe",
    ],
    pressSettings: "Press firmly; best hold after 24 hours",
    ctaLabel: "Open Builder",
  },
  "specialty-dtf": {
    subline: "Specialty finish that requires a true cold peel.",
    bullets: [
      "Use parchment/Teflon cover sheet",
      "Best on cotton/poly blends",
      "Not recommended for canvas",
    ],
    pressSettings: "325°F • 15s • peel completely cold",
    ctaLabel: "Open Builder",
  },
};

const PROFILE_ICONS: Record<string, React.ReactNode> = {
  "hot-peel": <IconHotPeel className="w-10 h-10" />,
  fluorescent: <IconFluorescent className="w-10 h-10" />,
  "uv-dtf": <IconUvDtf className="w-10 h-10" />,
  "specialty-dtf": <IconSpecialtyColdPeel className="w-10 h-10" />,
};

const PROFILE_GRADIENTS: Record<string, string> = {
  "hot-peel": "from-cyan-400 to-blue-500",
  fluorescent: "from-purple-400 to-pink-400",
  "uv-dtf": "from-amber-300 to-orange-400",
  "specialty-dtf": "[background:linear-gradient(120deg,#fbbf24_0%,#f8fafc_18%,#94a3b8_22%,#94a3b8_78%,#f8fafc_82%,#34d399_100%)]",
};

const PROFILE_ICON_TILES: Record<string, string> = {
  "hot-peel": "bg-cyan-500/10 border border-cyan-500/20 text-cyan-600",
  fluorescent: "bg-purple-500/10 border border-purple-500/20 text-purple-600",
  "uv-dtf": "bg-amber-500/10 border border-amber-500/20 text-amber-600",
  "specialty-dtf": "[background:linear-gradient(120deg,rgba(251,191,36,0.15)_0%,rgba(248,250,252,0.3)_18%,rgba(148,163,184,0.15)_22%,rgba(148,163,184,0.15)_78%,rgba(248,250,252,0.3)_82%,rgba(52,211,153,0.15)_100%)] border border-slate-200/50 text-emerald-700",
};

const PROFILE_GLOWS: Record<string, string> = {
  "hot-peel": "hover:shadow-cyan-500/20",
  fluorescent: "hover:shadow-purple-500/20",
  "uv-dtf": "hover:shadow-amber-500/20",
  "specialty-dtf": "hover:shadow-slate-300/30",
};

function ProfileCard({ profile }: { profile: ProfileConfig }) {
  const [, setLocation] = useLocation();
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");

  const content = CARD_CONTENT[profile.id] ?? {
    subline: profile.description,
    bullets: [],
    pressSettings: "",
    ctaLabel: "Open Builder",
  };

  const gradient = PROFILE_GRADIENTS[profile.id] ?? "from-gray-500 to-gray-600";
  const glow = PROFILE_GLOWS[profile.id] ?? "";
  const icon = PROFILE_ICONS[profile.id];

  const handleClick = (e: React.MouseEvent) => {
    if (profile.comingSoon) {
      e.preventDefault();
      setShowPasswordModal(true);
      setPasswordInput("");
    }
  };

  const handleProceed = () => {
    if (profile.comingSoon && passwordInput.trim() !== "") {
      setShowPasswordModal(false);
      setLocation(profile.route);
    }
  };

  const card = (
    <div
      onClick={handleClick}
      className={`group relative bg-white border border-gray-200 rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:border-gray-400 hover:shadow-2xl ${glow} hover:-translate-y-1 flex flex-col`}
    >
      {profile.comingSoon && (
        <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 text-[10px] font-semibold uppercase tracking-wide">
          Coming soon
        </div>
      )}

      {/* Icon container: unified tint formula */}
      <div
        className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${PROFILE_ICON_TILES[profile.id] ?? "bg-gray-500/10 border border-gray-500/20 text-gray-600"}`}
      >
        {icon}
      </div>

      {/* Title */}
      <h2 className="text-xl font-semibold text-gray-900 mb-2 tracking-wide">{profile.name}</h2>

      {/* Subline */}
      <p className="text-[15px] font-medium text-gray-800 mb-3 leading-snug">{content.subline}</p>

      {/* Bullets */}
      <ul className="space-y-1.5 mb-3">
        {content.bullets.map((b, i) => (
          <li key={i} className="text-[13px] text-gray-600 leading-relaxed flex gap-2">
            <span className="text-gray-400 mt-0.5">•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      {/* Press settings line - small, muted */}
      <p className="text-[12px] text-gray-500 opacity-80 mb-5 flex-1">{content.pressSettings}</p>

      {/* CTA Button - consistent 44-48px height */}
      <div
        className={`w-full h-12 rounded-xl bg-gradient-to-r ${gradient} flex items-center justify-center text-base font-semibold text-white opacity-90 group-hover:opacity-100 transition-opacity shadow-sm`}
      >
        {profile.comingSoon ? content.ctaLabel : content.ctaLabel}
      </div>
    </div>
  );

  return (
    <>
      {profile.comingSoon ? card : <Link href={profile.route}>{card}</Link>}
      {profile.comingSoon && showPasswordModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowPasswordModal(false)}
        >
          <div
            className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-gray-700 mb-4">This product is not yet available type password to proceed</p>
            <input
              type="password"
              placeholder="Enter password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-center font-mono text-lg mb-4 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowPasswordModal(false)}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleProceed}
                disabled={passwordInput.trim() === ""}
                className="flex-1 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="border-b border-gray-200 px-6 py-4">
        <h1
          className="text-2xl font-black tracking-widest text-center"
          style={{
            fontFamily: "'Orbitron', sans-serif",
            background: "linear-gradient(90deg, #06b6d4, #3b82f6, #8b5cf6, #06b6d4)",
            backgroundSize: "200% auto",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            animation: "gradientShift 4s linear infinite",
            filter: "drop-shadow(0 0 8px rgba(6,182,212,0.5))",
          }}
        >
          GANGSHEET BUILDER PRO
        </h1>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-6xl">
          <p className="text-center text-gray-700 mb-10 text-base font-semibold">Click on your desired product and start loading up your designs!</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {ALL_PROFILES.map((profile) => (
              <ProfileCard key={profile.id} profile={profile} />
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-200 px-6 py-3 text-center">
        <span className="text-[11px] text-gray-600">
          Have tips and app improvement suggestions? Send it over!{" "}
          <a href="mailto:Sales@dtfmasters.com" className="text-cyan-600 hover:text-cyan-700 font-semibold">
            Sales@dtfmasters.com
          </a>
        </span>
      </footer>
    </div>
  );
}
