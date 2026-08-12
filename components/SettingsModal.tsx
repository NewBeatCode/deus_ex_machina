import { type FC } from "react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: {
    gridSize: number;
    seed: string;
    objectDetection: boolean;
    renderFrameRate: number;
  };
  onUpdate: (newSettings: {
    gridSize: number;
    seed: string;
    objectDetection: boolean;
    renderFrameRate: number;
  }) => void;
}

export const SettingsModal: FC<SettingsModalProps> = ({ isOpen, onClose, settings, onUpdate }) => {
  if (!isOpen) return null;

  const GRID_SIZES = [2, 4, 6, 8];
  const SEEDS = ["Random", "Gosper glider gun", "R-pentomino"];
  const FRAME_RATES = [15, 24, 30, 45, 60];

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center backdrop-blur-xs" onClick={onClose}>
      <div 
        className="w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-xl p-6 shadow-2xl space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-white text-lg font-medium tracking-wide">Settings</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors">
            ✕
          </button>
        </div>

        {/* Grid Size */}
        <div className="space-y-3">
          <label className="text-xs text-white/50 uppercase tracking-wider font-mono">Grid Size (px)</label>
          <div className="flex gap-2">
            {GRID_SIZES.map((size) => (
              <button
                key={size}
                onClick={() => onUpdate({ ...settings, gridSize: size })}
                className={`flex-1 py-2 text-sm rounded font-mono transition-all ${
                  settings.gridSize === size
                    ? "bg-white text-black font-bold"
                    : "bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        {/* Seed Pattern */}
        <div className="space-y-3">
          <label className="text-xs text-white/50 uppercase tracking-wider font-mono">Initial Seed</label>
          <div className="grid grid-cols-1 gap-2">
            {SEEDS.map((seed) => (
              <button
                key={seed}
                 onClick={() => onUpdate({ ...settings, seed })}
                className={`w-full py-2 px-3 text-left text-sm rounded transition-all flex items-center justify-between group ${
                  settings.seed === seed
                    ? "bg-white text-black font-bold"
                    : "bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {seed}
                {settings.seed === seed && <span className="text-[10px] opacity-100">●</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Object Detection Toggle */}
        <div className="space-y-3">
          <label className="text-xs text-white/50 uppercase tracking-wider font-mono">Object Detection (COCO-SSD)</label>
          <button
            onClick={() => onUpdate({ ...settings, objectDetection: !settings.objectDetection })}
            className={`w-full py-2 px-3 text-sm rounded transition-all flex items-center justify-between ${
              settings.objectDetection
                ? "bg-white/10 text-white border border-white/20"
                : "bg-white/5 text-white/50 hover:bg-white/10"
            }`}
          >
            <span>{settings.objectDetection ? "Enabled" : "Disabled"}</span>
            <span className={`w-10 h-5 rounded-full transition-all relative ${
              settings.objectDetection ? "bg-white" : "bg-white/20"
            }`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                settings.objectDetection ? "left-5 bg-black" : "left-0.5 bg-white"
              }`} />
            </span>
          </button>
          <p className="text-[10px] text-white/30 font-mono">Detects common objects (person, phone, cup, etc.)</p>
        </div>
        
        {/* Render Frame Rate */}
        <div className="space-y-3">
          <label className="text-xs text-white/50 uppercase tracking-wider font-mono">
            Frame Rate (fps)
          </label>
          <div className="flex gap-2">
            {FRAME_RATES.map((fps) => (
              <button
                key={fps}
                onClick={() => onUpdate({ ...settings, renderFrameRate: fps })}
                className={`flex-1 py-2 text-sm rounded font-mono transition-all ${
                  settings.renderFrameRate === fps
                    ? "bg-white text-black font-bold"
                    : "bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {fps}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-white/30 font-mono">
            Lower this if hand tracking feels laggy or the fan spins up. 60 is
            smoothest, 15-24 is lightest on the CPU/GPU.
          </p>
        </div>

        <div className="pt-2 text-[10px] text-white/30 text-center font-mono">
          Changes apply immediately on selection
        </div>
      </div>
    </div>
  );
};
