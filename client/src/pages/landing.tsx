import { Link } from "wouter";
import { ALL_PROFILES, type ProfileConfig } from "@/lib/profiles";
import { Zap, Sparkles, Sun, Diamond } from "lucide-react";

const PROFILE_ICONS: Record<string, React.ReactNode> = {
  'hot-peel': <Zap className="w-8 h-8" />,
  'fluorescent': <Sparkles className="w-8 h-8" />,
  'uv-dtf': <Sun className="w-8 h-8" />,
  'specialty-dtf': <Diamond className="w-8 h-8" />,
};

const PROFILE_GRADIENTS: Record<string, string> = {
  'hot-peel': 'from-cyan-500 to-blue-600',
  'fluorescent': 'from-purple-500 to-pink-500',
  'uv-dtf': 'from-amber-400 to-orange-500',
  'specialty-dtf': 'from-yellow-300 to-yellow-500',
};

const PROFILE_GLOWS: Record<string, string> = {
  'hot-peel': 'hover:shadow-cyan-500/30',
  'fluorescent': 'hover:shadow-purple-500/30',
  'uv-dtf': 'hover:shadow-amber-500/30',
  'specialty-dtf': 'hover:shadow-yellow-400/30',
};

function ProfileCard({ profile }: { profile: ProfileConfig }) {
  const gradient = PROFILE_GRADIENTS[profile.id] ?? 'from-gray-500 to-gray-600';
  const glow = PROFILE_GLOWS[profile.id] ?? '';
  const icon = PROFILE_ICONS[profile.id];

  return (
    <Link href={profile.route}>
      <div className={`group relative bg-gray-900 border border-gray-800 rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:border-gray-600 hover:shadow-2xl ${glow} hover:-translate-y-1`}>
        <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white mb-4 shadow-lg`}>
          {icon}
        </div>
        <h2 className="text-xl font-bold text-white mb-1 tracking-wide">{profile.name}</h2>
        <p className="text-sm text-gray-400 mb-4 leading-relaxed">{profile.description}</p>
        <div className="space-y-1.5 text-xs text-gray-500">
          <div className="flex justify-between">
            <span>Width</span>
            <span className="text-gray-300 font-semibold">{profile.artboardWidth}"</span>
          </div>
          <div className="flex justify-between">
            <span>Heights</span>
            <span className="text-gray-300 font-semibold">
              {profile.gangsheetHeights.length <= 5
                ? profile.gangsheetHeights.map(h => `${h}"`).join(', ')
                : `${profile.gangsheetHeights[0]}" – ${profile.gangsheetHeights[profile.gangsheetHeights.length - 1]}"`}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Download</span>
            <span className="text-gray-300 font-semibold uppercase">{profile.downloadFormat}</span>
          </div>
          {profile.enableFluorescent && (
            <div className="flex justify-between">
              <span>Fluorescent</span>
              <span className="text-purple-400 font-semibold">Enabled</span>
            </div>
          )}
        </div>
        <div className={`mt-5 w-full py-2.5 rounded-lg bg-gradient-to-r ${gradient} text-center text-sm font-semibold text-white opacity-80 group-hover:opacity-100 transition-opacity`}>
          Open Builder
        </div>
      </div>
    </Link>
  );
}

export default function Landing() {
  return (
    <div className="min-h-screen bg-black flex flex-col">
      <header className="border-b border-gray-800 px-6 py-4">
        <h1
          className="text-2xl font-black tracking-widest text-center"
          style={{
            fontFamily: "'Orbitron', sans-serif",
            background: 'linear-gradient(90deg, #06b6d4, #3b82f6, #8b5cf6, #06b6d4)',
            backgroundSize: '200% auto',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            animation: 'gradientShift 4s linear infinite',
            filter: 'drop-shadow(0 0 8px rgba(6,182,212,0.5))',
          }}
        >
          GANGSHEET BUILDER PRO
        </h1>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-6xl">
          <p className="text-center text-gray-400 mb-10 text-sm">Choose a print profile to get started</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {ALL_PROFILES.map(profile => (
              <ProfileCard key={profile.id} profile={profile} />
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-800 px-6 py-3 text-center">
        <span className="text-[11px] text-gray-500">
          Have tips and app improvement suggestions? Send it over!{' '}
          <a href="mailto:Sales@dtfmasters.com" className="text-cyan-400 hover:text-cyan-300 font-semibold">
            Sales@dtfmasters.com
          </a>
        </span>
      </footer>
    </div>
  );
}
