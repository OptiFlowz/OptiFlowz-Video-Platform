const maintenanceAnimation = `
<svg width="760" height="420" viewBox="0 0 760 420" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bb8BodyClip">
      <circle cx="165" cy="258" r="44"/>
    </clipPath>
  </defs>
  <style>
    .droid-track { animation: droidTrack 7.2s ease-in-out infinite; }
    .droid-bob { animation: droidBob 2.1s ease-in-out infinite; transform-origin: 165px 258px; }
    .body-roll { animation: bodyRoll 7.2s ease-in-out infinite; transform-origin: 165px 258px; }
    .head-look { animation: headLook 7.2s ease-in-out infinite; transform-origin: 165px 192px; }
    .antenna-wobble { animation: antennaWobble 1.35s ease-in-out infinite; transform-origin: 145px 177px; }
    .hammer-carrier { animation: hammerCarry 7.2s linear infinite; }
    .hammer-tilt { animation: hammerTilt 7.2s ease-in-out infinite; transform-origin: 0px 0px; }
    .monitor-group { animation: monitorShake 7.2s linear infinite; transform-origin: 380px 182px; }
    .tower-group { animation: towerShake 7.2s linear infinite; transform-origin: 532px 218px; }
    .screen-glow { animation: screenGlow 3s ease-in-out infinite; }
    .blink { animation: blink 4.8s infinite; transform-origin: center; }
    .spark { opacity: 0; transform-box: fill-box; transform-origin: center; }
    .monitor-spark-a { animation: monitorSparkA 7.2s linear infinite; }
    .monitor-spark-b { animation: monitorSparkB 7.2s linear infinite; }
    .monitor-spark-c { animation: monitorSparkC 7.2s linear infinite; }
    .tower-spark-a { animation: towerSparkA 7.2s linear infinite; }
    .tower-spark-b { animation: towerSparkB 7.2s linear infinite; }
    .tower-spark-c { animation: towerSparkC 7.2s linear infinite; }
    @keyframes droidTrack { 0%, 100% { transform: translateX(0px); } 16% { transform: translateX(58px); } 22% { transform: translateX(58px); } 30% { transform: translateX(22px); } 58% { transform: translateX(450px); } 64% { transform: translateX(450px); } 72% { transform: translateX(486px); } 100% { transform: translateX(0px); } }
    @keyframes droidBob { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-4px); } }
    @keyframes bodyRoll { 0% { transform: rotate(0deg); } 16% { transform: rotate(82deg); } 22% { transform: rotate(82deg); } 30% { transform: rotate(35deg); } 58% { transform: rotate(560deg); } 64% { transform: rotate(560deg); } 72% { transform: rotate(528deg); } 100% { transform: rotate(0deg); } }
    @keyframes headLook { 0%, 100% { transform: rotate(6deg) translateY(0px); } 16% { transform: rotate(1deg) translateY(0px); } 22% { transform: rotate(-2deg) translateY(0px); } 30% { transform: rotate(8deg) translateY(-1px); } 50% { transform: rotate(-2deg) translateY(0px); } 58% { transform: rotate(-7deg) translateY(0px); } 64% { transform: rotate(-10deg) translateY(0px); } 72% { transform: rotate(-13deg) translateY(-1px); } 88% { transform: rotate(4deg) translateY(0px); } }
    @keyframes antennaWobble { 0%, 100% { transform: rotate(-2deg); } 25% { transform: rotate(8deg); } 50% { transform: rotate(-6deg); } 75% { transform: rotate(5deg); } }
    @keyframes hammerCarry { 0% { transform: translate(232px, 248px); } 16% { transform: translate(232px, 248px); } 20% { transform: translate(242px, 248px); } 23% { transform: translate(232px, 248px); } 32% { transform: translate(232px, 248px); } 40% { transform: translate(206px, 254px); } 46% { transform: translate(172px, 262px); } 52% { transform: translate(128px, 262px); } 58% { transform: translate(92px, 248px); } 62% { transform: translate(72px, 246px); } 65% { transform: translate(92px, 248px); } 72% { transform: translate(92px, 248px); } 84% { transform: translate(128px, 262px); } 92% { transform: translate(172px, 262px); } 100% { transform: translate(232px, 248px); } }
    @keyframes hammerTilt { 0%, 18%, 100% { transform: rotate(0deg); } 20% { transform: rotate(16deg); } 22.5% { transform: rotate(-6deg); } 25% { transform: rotate(0deg); } 60.8% { transform: rotate(4deg); } 62.2% { transform: rotate(-20deg); } 64.8% { transform: rotate(7deg); } 67% { transform: rotate(0deg); } }
    @keyframes monitorShake { 0%, 19%, 100% { transform: translateX(0px) rotate(0deg); } 22% { transform: translateX(3px) rotate(1deg); } 24% { transform: translateX(-1px) rotate(-0.5deg); } 27% { transform: translateX(0px) rotate(0deg); } }
    @keyframes towerShake { 0%, 61%, 100% { transform: translateX(0px) rotate(0deg); } 64% { transform: translateX(-3px) rotate(-1deg); } 66% { transform: translateX(1px) rotate(0.4deg); } 69% { transform: translateX(0px) rotate(0deg); } }
    @keyframes monitorSparkA { 0%, 19%, 100% { opacity: 0; transform: translate(0px, 0px) scale(0.15); } 22% { opacity: 1; transform: translate(-8px, -8px) scale(1); } 24.5% { opacity: 0.9; transform: translate(-16px, -16px) scale(1.08); } 28% { opacity: 0; transform: translate(-22px, -22px) scale(0.8); } }
    @keyframes monitorSparkB { 0%, 19%, 100% { opacity: 0; transform: translate(0px, 0px) scale(0.15); } 22% { opacity: 1; transform: translate(10px, -4px) scale(1); } 24.5% { opacity: 0.9; transform: translate(18px, -10px) scale(1.08); } 28% { opacity: 0; transform: translate(25px, -14px) scale(0.8); } }
    @keyframes monitorSparkC { 0%, 19%, 100% { opacity: 0; transform: translate(0px, 0px) scale(0.15); } 22% { opacity: 1; transform: translate(-2px, 10px) scale(1); } 24.5% { opacity: 0.9; transform: translate(-6px, 18px) scale(1.08); } 28% { opacity: 0; transform: translate(-10px, 24px) scale(0.8); } }
    @keyframes towerSparkA { 0%, 61%, 100% { opacity: 0; transform: translate(0px, 0px) scale(0.15); } 64% { opacity: 1; transform: translate(-10px, -8px) scale(1); } 66.5% { opacity: 0.9; transform: translate(-18px, -16px) scale(1.08); } 70% { opacity: 0; transform: translate(-24px, -22px) scale(0.8); } }
    @keyframes towerSparkB { 0%, 61%, 100% { opacity: 0; transform: translate(0px, 0px) scale(0.15); } 64% { opacity: 1; transform: translate(10px, -4px) scale(1); } 66.5% { opacity: 0.9; transform: translate(18px, -10px) scale(1.08); } 70% { opacity: 0; transform: translate(24px, -14px) scale(0.8); } }
    @keyframes towerSparkC { 0%, 61%, 100% { opacity: 0; transform: translate(0px, 0px) scale(0.15); } 64% { opacity: 1; transform: translate(-2px, 10px) scale(1); } 66.5% { opacity: 0.9; transform: translate(-6px, 18px) scale(1.08); } 70% { opacity: 0; transform: translate(-10px, 24px) scale(0.8); } }
    @keyframes screenGlow { 0%, 100% { opacity: 0.92; } 50% { opacity: 1; } }
    @keyframes blink { 0%, 44%, 48%, 100% { transform: scaleY(1); } 46% { transform: scaleY(0.12); } }
  </style>
  <rect width="760" height="420" rx="28" fill="#F8FAFD"/>
  <ellipse cx="380" cy="350" rx="235" ry="18" fill="#091c42" opacity="0.07"/>
  <g class="monitor-group">
    <rect x="300" y="126" width="160" height="110" rx="18" fill="#FFFFFF" stroke="#164194" stroke-width="4"/>
    <rect class="screen-glow" x="314" y="140" width="132" height="80" rx="10" fill="#091c42"/>
    <circle cx="350" cy="180" r="10" fill="none" stroke="#ec8b55" stroke-width="4"/>
    <path d="M350 170 L350 180 L358 186" stroke="#ec8b55" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="372" y="172" width="40" height="8" rx="4" fill="#164194" opacity="0.35"/>
    <rect x="372" y="186" width="28" height="8" rx="4" fill="#ec8b55"/>
    <circle cx="419" cy="190" r="4" fill="#ec8b55"/>
    <rect x="370" y="236" width="20" height="16" rx="5" fill="#164194"/>
    <rect x="340" y="250" width="80" height="8" rx="4" fill="#164194" opacity="0.18"/>
  </g>
  <g class="tower-group">
    <rect x="500" y="162" width="64" height="112" rx="14" fill="#FFFFFF" stroke="#164194" stroke-width="4"/>
    <rect x="516" y="180" width="32" height="6" rx="3" fill="#164194" opacity="0.22"/>
    <circle cx="532" cy="212" r="6" fill="#ec8b55"/>
    <circle cx="532" cy="236" r="4" fill="#164194" opacity="0.22"/>
    <circle cx="532" cy="253" r="4" fill="#164194" opacity="0.22"/>
  </g>
  <path d="M460 220 C478 220, 486 220, 500 220" stroke="#164194" stroke-width="4" stroke-linecap="round" opacity="0.35"/>
  <g transform="translate(302 216)">
    <path class="spark monitor-spark-a" d="M0 -8 L3 -3 L8 0 L3 3 L0 8 L-3 3 L-8 0 L-3 -3 Z" fill="#ec8b55"/>
    <path class="spark monitor-spark-b" d="M0 -6 L2.5 -2.5 L6 0 L2.5 2.5 L0 6 L-2.5 2.5 L-6 0 L-2.5 -2.5 Z" fill="#164194"/>
    <path class="spark monitor-spark-c" d="M0 -5 L2 -2 L5 0 L2 2 L0 5 L-2 2 L-5 0 L-2 -2 Z" fill="#ec8b55"/>
  </g>
  <g transform="translate(508 220)">
    <path class="spark tower-spark-a" d="M0 -8 L3 -3 L8 0 L3 3 L0 8 L-3 3 L-8 0 L-3 -3 Z" fill="#ec8b55"/>
    <path class="spark tower-spark-b" d="M0 -6 L2.5 -2.5 L6 0 L2.5 2.5 L0 6 L-2.5 2.5 L-6 0 L-2.5 -2.5 Z" fill="#164194"/>
    <path class="spark tower-spark-c" d="M0 -5 L2 -2 L5 0 L2 2 L0 5 L-2 2 L-5 0 L-2 -2 Z" fill="#ec8b55"/>
  </g>
  <g class="droid-track">
    <g class="droid-bob">
      <ellipse cx="165" cy="318" rx="48" ry="10" fill="#091c42" opacity="0.08"/>
      <circle cx="165" cy="258" r="44" fill="#FFFFFF" stroke="#164194" stroke-width="4"/>
      <g class="body-roll" clip-path="url(#bb8BodyClip)">
        <circle cx="165" cy="258" r="44" fill="#FFFFFF"/>
        <circle cx="165" cy="258" r="18" fill="none" stroke="#ec8b55" stroke-width="6"/>
        <circle cx="165" cy="258" r="7" fill="#164194"/>
        <circle cx="138" cy="243" r="10" fill="none" stroke="#ec8b55" stroke-width="5"/>
        <circle cx="138" cy="243" r="3.5" fill="#164194"/>
        <circle cx="192" cy="276" r="10" fill="none" stroke="#ec8b55" stroke-width="5"/>
        <circle cx="192" cy="276" r="3.5" fill="#164194"/>
        <path d="M132 274 C144 280, 152 284, 164 286" stroke="#ec8b55" stroke-width="5" stroke-linecap="round"/>
        <path d="M179 232 C188 234, 195 238, 200 244" stroke="#ec8b55" stroke-width="5" stroke-linecap="round"/>
      </g>
      <circle cx="165" cy="258" r="44" fill="none" stroke="#164194" stroke-width="4"/>
      <g class="head-look">
        <path d="M130 205 C130 185, 146 172, 165 172 C184 172, 200 185, 200 205 L200 214 L130 214 Z" fill="#FFFFFF" stroke="#164194" stroke-width="4" stroke-linejoin="round"/>
        <g class="antenna-wobble">
          <rect x="144" y="159" width="2.5" height="18" rx="1.25" fill="#164194"/>
          <circle cx="145.25" cy="156.5" r="3.5" fill="#ec8b55"/>
          <circle cx="145.25" cy="177" r="2.2" fill="#164194"/>
        </g>
        <path d="M138 191 H192" stroke="#ec8b55" stroke-width="5" stroke-linecap="round"/>
        <path d="M144 200 H186" stroke="#164194" stroke-width="3.5" stroke-linecap="round" opacity="0.35"/>
        <circle cx="166" cy="196" r="11" fill="#091c42"/>
        <circle cx="166" cy="196" r="4" fill="#FFFFFF" opacity="0.95"/>
        <g class="blink">
          <circle cx="186" cy="204" r="4.5" fill="#091c42"/>
        </g>
      </g>
      <g class="hammer-carrier">
        <g class="hammer-tilt">
          <circle cx="0" cy="0" r="7" fill="#164194"/>
          <rect x="-4" y="-28" width="8" height="46" rx="4" fill="#ec8b55"/>
          <rect x="-18" y="-38" width="36" height="12" rx="6" fill="#164194"/>
        </g>
      </g>
    </g>
  </g>
</svg>
`;

type MaintenancePageProps = {
  isChecking: boolean;
  onRetry: () => void;
};

export default function MaintenancePage({ isChecking, onRetry }: MaintenancePageProps) {
  return (
    <main className="maintenance-shell">
      <section className="maintenance-card">
        <div className="maintenance-copy">
          <span className="maintenance-badge">
            {isChecking ? "Checking server status" : "Maintenance mode"}
          </span>
          <h1>{isChecking ? "Connecting to the server..." : "We are temporarily unavailable."}</h1>
          <p>
            {isChecking
              ? "The app is waiting for the server to respond before loading the rest of the experience."
              : "The server cannot be reached right now. Please try again later."}
          </p>
          <button
            type="button"
            className="button maintenance-retry"
            onClick={onRetry}
            disabled={isChecking}
          >
            {isChecking ? "Checking..." : "Try again"}
          </button>
        </div>
        <div
          className="maintenance-visual"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: maintenanceAnimation }}
        />
      </section>
    </main>
  );
}
