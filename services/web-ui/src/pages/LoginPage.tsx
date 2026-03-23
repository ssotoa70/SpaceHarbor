import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../design-system";
import { useAuth } from "../contexts/AuthContext";


/* ── Animated starfield background ── */
function Starfield() {
  // Generate a dense field of stars with varied sizes, opacities, and flicker timings
  const stars: Array<{ x: number; y: number; r: number; o: number; d: number; c: string }> = [];
  // Use a seeded-style deterministic spread (no Math.random — SSR-safe, consistent across renders)
  const seed = [
    17,53,89,23,67,41,97,31,73,11,59,83,29,71,43,7,61,37,79,3,
    47,19,91,13,57,81,27,69,39,87,9,51,77,21,63,33,93,15,55,85,
    25,65,45,5,49,75,35,95,1,99,50,22,78,34,66,42,88,14,56,82,
    28,72,38,92,8,52,76,18,62,36,86,12,58,84,24,68,44,4,48,74,
    32,96,16,54,80,26,64,46,6,60,90,20,70,40,2,98,30,10,100,50,
  ];
  for (let i = 0; i < 100; i++) {
    const s = seed[i % seed.length];
    stars.push({
      x: ((s * 19 + i * 37) % 100),
      y: ((s * 13 + i * 29) % 100),
      r: (i % 7 === 0) ? 2.5 : (i % 3 === 0) ? 1.8 : (i % 2 === 0) ? 1.2 : 0.8,
      o: 0.3 + (s % 7) * 0.1,
      d: 2 + (s % 5),                 // flicker duration in seconds
      c: (i % 11 === 0) ? "#67e8f9" : (i % 13 === 0) ? "#a5f3fc" : (i % 17 === 0) ? "#dbeafe" : "white",
    });
  }

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <style>{`
        @keyframes flicker {
          0%, 100% { opacity: var(--base-o); }
          50% { opacity: 1; }
        }
        @keyframes flicker-alt {
          0%, 100% { opacity: var(--base-o); }
          30% { opacity: 0.1; }
          60% { opacity: 0.95; }
        }
        .star {
          position: absolute;
          border-radius: 50%;
        }
      `}</style>
      {stars.map((s, i) => {
        const flicker = i % 3 === 0; // ~1/3 of stars flicker
        return (
          <div
            key={i}
            className="star"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.r * 2,
              height: s.r * 2,
              backgroundColor: s.c,
              opacity: flicker ? undefined : s.o,
              ["--base-o" as string]: s.o,
              animation: flicker
                ? `${i % 2 === 0 ? "flicker" : "flicker-alt"} ${s.d}s ease-in-out ${(i * 0.3) % 4}s infinite`
                : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

/* ── Inline animated logo (based on spaceharbor-navy.svg) ── */
function AnimatedLogo() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 160" className="w-[480px]">
      <defs>
        <linearGradient id="navyBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#020b18" />
          <stop offset="100%" stopColor="#051525" />
        </linearGradient>
        <linearGradient id="nFacetTop" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="50%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#0891b2" />
        </linearGradient>
        <linearGradient id="nFacetShaft" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0e7490" />
          <stop offset="50%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#0e7490" />
        </linearGradient>
        <linearGradient id="nFacetArm" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#0891b2" />
          <stop offset="100%" stopColor="#155e75" />
        </linearGradient>
        <linearGradient id="nGoldAccent" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
        <radialGradient id="nIconGlow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="nOrbitGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.05" />
          <stop offset="40%" stopColor="#67e8f9" stopOpacity="0.7" />
          <stop offset="60%" stopColor="#38bdf8" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="nTextGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
        <filter id="nGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="nTextGlow">
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <style>{`
        @keyframes star-twinkle-1 { 0%,100% { opacity:0.3; } 50% { opacity:1; } }
        @keyframes star-twinkle-2 { 0%,100% { opacity:0.5; } 50% { opacity:0.1; } }
        @keyframes star-twinkle-3 { 0%,100% { opacity:0.2; } 40% { opacity:0.9; } }
        @keyframes orbit-pulse { 0%,100% { opacity:0.7; } 50% { opacity:1; } }
        @keyframes glow-breathe { 0%,100% { opacity:0.2; } 50% { opacity:0.35; } }
        @keyframes anchor-dot-pulse { 0%,100% { r:2.5; opacity:0.8; } 50% { r:3.5; opacity:1; } }
        @keyframes anchor-dot-pulse-sm { 0%,100% { r:2; opacity:0.6; } 50% { r:3; opacity:1; } }
        .star-a1 { animation: star-twinkle-1 3s ease-in-out infinite; }
        .star-a2 { animation: star-twinkle-2 4s ease-in-out 0.5s infinite; }
        .star-a3 { animation: star-twinkle-3 2.5s ease-in-out 1s infinite; }
        .star-a4 { animation: star-twinkle-1 3.5s ease-in-out 0.3s infinite; }
        .star-a5 { animation: star-twinkle-2 5s ease-in-out 1.5s infinite; }
        .star-a6 { animation: star-twinkle-3 4.5s ease-in-out 0.8s infinite; }
        .star-a7 { animation: star-twinkle-1 3.8s ease-in-out 2s infinite; }
        .star-a8 { animation: star-twinkle-2 2.8s ease-in-out 0.6s infinite; }
        .star-a9 { animation: star-twinkle-3 4.2s ease-in-out 1.2s infinite; }
        .star-a10 { animation: star-twinkle-1 5.5s ease-in-out 1.8s infinite; }
        .star-a11 { animation: star-twinkle-2 3.2s ease-in-out 2.5s infinite; }
        .star-a12 { animation: star-twinkle-3 4.8s ease-in-out 0.4s infinite; }
        .orbit-anim { animation: orbit-pulse 4s ease-in-out infinite; }
        .glow-anim { animation: glow-breathe 5s ease-in-out infinite; }
        .dot-pulse { animation: anchor-dot-pulse 2.5s ease-in-out infinite; }
        .dot-pulse-sm { animation: anchor-dot-pulse-sm 3s ease-in-out 0.5s infinite; }
      `}</style>

      {/* Background */}
      <rect width="480" height="160" fill="url(#navyBg)" rx="12" />

      {/* Grid lines */}
      <g opacity="0.04" stroke="#22d3ee" strokeWidth="0.5">
        <line x1="0" y1="40" x2="480" y2="40" />
        <line x1="0" y1="80" x2="480" y2="80" />
        <line x1="0" y1="120" x2="480" y2="120" />
        <line x1="120" y1="0" x2="120" y2="160" />
        <line x1="240" y1="0" x2="240" y2="160" />
        <line x1="360" y1="0" x2="360" y2="160" />
      </g>

      {/* Animated starfield */}
      <g>
        <circle className="star-a1" cx="28" cy="18" r="0.8" fill="white" />
        <circle className="star-a2" cx="52" cy="42" r="0.4" fill="white" />
        <circle className="star-a3" cx="418" cy="28" r="0.9" fill="#67e8f9" />
        <circle className="star-a4" cx="452" cy="52" r="0.5" fill="white" />
        <circle className="star-a5" cx="438" cy="132" r="0.6" fill="white" />
        <circle className="star-a6" cx="22" cy="118" r="0.5" fill="#38bdf8" />
        <circle className="star-a7" cx="378" cy="14" r="0.4" fill="white" />
        <circle className="star-a8" cx="462" cy="98" r="0.7" fill="#67e8f9" />
        <circle className="star-a9" cx="32" cy="78" r="0.4" fill="white" />
        <circle className="star-a10" cx="398" cy="148" r="0.5" fill="white" />
        <circle className="star-a11" cx="200" cy="12" r="0.5" fill="#67e8f9" />
        <circle className="star-a12" cx="310" cy="148" r="0.4" fill="white" />
      </g>

      {/* Ambient glow - breathing */}
      <ellipse className="glow-anim" cx="80" cy="80" rx="55" ry="55" fill="url(#nIconGlow)" />

      {/* Back orbital ring - pulsing */}
      <ellipse className="orbit-anim" cx="80" cy="80" rx="48" ry="14" fill="none" stroke="url(#nOrbitGrad)" strokeWidth="1.2" />
      <ellipse cx="80" cy="80" rx="48" ry="14" fill="none" stroke="#051525" strokeWidth="1.5" strokeDasharray="80 70" strokeDashoffset="0" />

      {/* Top ring */}
      <polygon points="80,32 86,35.5 86,41 80,44.5 74,41 74,35.5" fill="url(#nFacetTop)" opacity="0.9" />
      <polygon points="80,36 83,37.8 83,40.2 80,42 77,40.2 77,37.8" fill="#051525" />
      <line x1="80" y1="32" x2="86" y2="35.5" stroke="#a5f3fc" strokeWidth="0.8" opacity="0.9" />
      <polygon points="80,30 88,34 88,42 80,46 72,42 72,34" fill="none" stroke="#0891b2" strokeWidth="0.8" opacity="0.4" />

      {/* Shaft */}
      <polygon points="77,44 83,44 83,88 77,88" fill="url(#nFacetShaft)" />
      <polygon points="75,45.5 77,44 77,88 75,89.5" fill="#164e63" opacity="0.9" />
      <polygon points="83,44 85,45.5 85,89.5 83,88" fill="#22d3ee" opacity="0.5" />
      <line x1="77" y1="44" x2="83" y2="44" stroke="#a5f3fc" strokeWidth="0.8" />

      {/* Crossbar */}
      <polygon points="55,62 77,62 77,68 55,68" fill="url(#nFacetArm)" />
      <polygon points="55,68 77,68 77,70 55,70" fill="#164e63" />
      <polygon points="52,65 57,62 57,68 52,65" fill="#0891b2" />
      <polygon points="52,65 57,68 57,70 52,65" fill="#0c4a6e" />
      <polygon points="83,62 105,62 105,68 83,68" fill="url(#nFacetArm)" />
      <polygon points="83,68 105,68 105,70 83,70" fill="#164e63" />
      <polygon points="108,65 103,62 103,68 108,65" fill="#0e7490" />
      <polygon points="108,65 103,68 103,70 108,65" fill="#0c4a6e" />

      {/* Bottom flukes */}
      <polygon points="77,88 80,98 62,106 60,94" fill="#0891b2" />
      <polygon points="77,88 60,94 62,106 58,108 56,96 68,84" fill="#155e75" opacity="0.8" />
      <polygon points="77,88 80,98 62,106" fill="#22d3ee" opacity="0.6" />
      <line x1="77" y1="88" x2="62" y2="106" stroke="#67e8f9" strokeWidth="0.6" opacity="0.7" />
      <polygon points="83,88 80,98 98,106 100,94" fill="#0e7490" />
      <polygon points="83,88 100,94 98,106 102,108 104,96 92,84" fill="#155e75" opacity="0.8" />
      <polygon points="83,88 80,98 98,106" fill="#38bdf8" opacity="0.6" />
      <line x1="83" y1="88" x2="98" y2="106" stroke="#a5f3fc" strokeWidth="0.6" opacity="0.7" />

      {/* Bottom tip */}
      <polygon points="77,88 83,88 80,100" fill="url(#nGoldAccent)" filter="url(#nGlow)" />

      {/* Animated accent dots - pulsing glow */}
      <circle className="dot-pulse" cx="52" cy="65" r="2.5" fill="#38bdf8" filter="url(#nGlow)" />
      <circle className="dot-pulse" cx="108" cy="65" r="2.5" fill="#38bdf8" filter="url(#nGlow)" />
      <circle className="dot-pulse-sm" cx="62" cy="106" r="2" fill="#67e8f9" filter="url(#nGlow)" />
      <circle className="dot-pulse-sm" cx="98" cy="106" r="2" fill="#67e8f9" filter="url(#nGlow)" />

      {/* Front orbital ring - pulsing */}
      <path className="orbit-anim" d="M 48 87 A 48 14 0 0 0 112 87" fill="none" stroke="url(#nOrbitGrad)" strokeWidth="1.2" />

      {/* Typography */}
      <text x="148" y="72" fontFamily="'Trebuchet MS', 'Gill Sans', sans-serif" fontSize="36" fontWeight="300" letterSpacing="3" fill="#cbd5e1" filter="url(#nTextGlow)">Space</text>
      <text x="146" y="108" fontFamily="'Trebuchet MS', 'Gill Sans', sans-serif" fontSize="36" fontWeight="700" letterSpacing="2" fill="url(#nTextGrad)" filter="url(#nTextGlow)">Harbor</text>
      <line x1="148" y1="78" x2="380" y2="78" stroke="#22d3ee" strokeWidth="0.8" opacity="0.4" />
      <text x="150" y="130" fontFamily="'Trebuchet MS', monospace" fontSize="9" letterSpacing="4" fill="#0891b2" opacity="0.9">POWERED BY VAST DATA</text>
    </svg>
  );
}

export function LoginPage() {
  const { authMode, isAuthenticated, login, initiateOidcLogin, handleOidcCallback } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Handle OIDC callback with authorization code
  useEffect(() => {
    const code = searchParams.get("code");
    if (code && authMode === "oidc") {
      // Verify state parameter to prevent OAuth CSRF
      const returnedState = searchParams.get("state");
      const savedState = sessionStorage.getItem("ah_oidc_state");
      sessionStorage.removeItem("ah_oidc_state");
      if (!savedState || returnedState !== savedState) {
        setError("Authentication failed: state mismatch. Please try again.");
        return;
      }

      const codeVerifier = sessionStorage.getItem("ah_pkce_verifier");
      if (codeVerifier) {
        sessionStorage.removeItem("ah_pkce_verifier");
        void handleOidcCallback(code, codeVerifier)
          .then(() => navigate("/", { replace: true }))
          .catch(() => setError("SSO authentication failed. Please try again."));
      }
    }
  }, [searchParams, authMode, handleOidcCallback, navigate]);

  const handleLocalLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch {
      setError("Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  }, [email, password, login, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-ah-bg)] relative">
      <Starfield />

      <div className="w-full max-w-lg p-10 rounded-[var(--radius-ah-lg)] bg-[var(--color-ah-bg-raised)]/95 backdrop-blur-sm border border-[var(--color-ah-border-muted)] relative z-10">
        {/* Animated Logo */}
        <div className="flex flex-col items-center mb-8">
          <AnimatedLogo />
          <p className="text-sm text-[var(--color-ah-text-muted)] mt-4">Sign in to your account</p>
        </div>

        {error && (
          <div
            className="mb-4 p-3 rounded-[var(--radius-ah-sm)] bg-[var(--color-ah-danger)]/10 border border-[var(--color-ah-danger)]/30 text-sm text-[var(--color-ah-danger)]"
            role="alert"
          >
            {error}
          </div>
        )}

        {authMode === "oidc" ? (
          /* ── OIDC Mode ── */
          <div className="space-y-4">
            <Button
              variant="primary"
              onClick={initiateOidcLogin}
              className="w-full justify-center"
              data-testid="sso-button"
            >
              Sign in with SSO
            </Button>
          </div>
        ) : (
          /* ── Local Mode ── */
          <form onSubmit={(e) => void handleLocalLogin(e)} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[var(--color-ah-text-muted)] mb-1" htmlFor="login-email">
                Email
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full px-3 py-2 bg-[var(--color-ah-bg)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm text-[var(--color-ah-text)] placeholder:text-[var(--color-ah-text-subtle)] focus:outline-none focus:border-[var(--color-ah-accent)] focus:ring-1 focus:ring-[var(--color-ah-accent)]"
                placeholder="you@studio.com"
                data-testid="email-input"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[var(--color-ah-text-muted)] mb-1" htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full px-3 py-2 bg-[var(--color-ah-bg)] border border-[var(--color-ah-border-muted)] rounded-[var(--radius-ah-sm)] text-sm text-[var(--color-ah-text)] placeholder:text-[var(--color-ah-text-subtle)] focus:outline-none focus:border-[var(--color-ah-accent)] focus:ring-1 focus:ring-[var(--color-ah-accent)]"
                placeholder="Enter your password"
                data-testid="password-input"
              />
            </div>

            <Button
              variant="primary"
              type="submit"
              disabled={submitting || !email || !password}
              className="w-full justify-center"
              data-testid="login-button"
            >
              {submitting ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        )}

      </div>
    </div>
  );
}
