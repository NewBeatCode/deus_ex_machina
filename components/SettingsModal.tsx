import { type FC } from "react";
import { getAllPresetCategories } from "./presets/index";

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
  const FRAME_RATES = [15, 24, 30, 45, 60];
  const presetCategories = getAllPresetCategories();

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center" onClick={onClose}>
      <div 
        className="w-full max-w-sm bg-[#1a1a1a] border border-white/10 rounded-xl p-6 shadow-2xl space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-white text-lg font-medium tracking-wide">Settings</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white transition-colors cursor-pointer">
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
                className={`flex-1 py-2 text-sm rounded font-mono transition-all cursor-pointer ${
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

        {/* Seed Preset Dropdown */}
        <div className="space-y-2">
          <label className="text-xs text-white/50 uppercase tracking-wider font-mono flex justify-between items-center">
            <span>Pattern Preset</span>
            <span className="text-[10px] text-white/40 lowercase">({settings.seed})</span>
          </label>
          <div className="relative">
            <select
              value={settings.seed}
              onChange={(e) => onUpdate({ ...settings, seed: e.target.value })}
              className="w-full py-2.5 px-3 pr-8 bg-[#242424] border border-white/15 rounded-lg text-sm text-white font-mono appearance-none focus:outline-none focus:border-white/50 focus:ring-1 focus:ring-white/30 transition-all cursor-pointer"
            >
              <option value="Random" className="bg-[#1a1a1a] text-white py-1">
                Random
              </option>
              {presetCategories.map((group) => (
                <optgroup key={group.category} label={group.category} className="bg-[#1a1a1a] text-white/60 font-semibold">
                  {group.names.map((name) => (
                    <option key={name} value={name} className="bg-[#242424] text-white py-1 font-mono font-normal">
                      {name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-white/50">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
              </svg>
            </div>
          </div>
          <p className="text-[10px] text-white/30 font-mono">
            Select an initial Game of Life preset pattern from the library
          </p>
        </div>

        {/* Object Detection Toggle */}
        <div className="space-y-3">
          <label className="text-xs text-white/50 uppercase tracking-wider font-mono">Object Detection (COCO-SSD)</label>
          <button
            onClick={() => onUpdate({ ...settings, objectDetection: !settings.objectDetection })}
            className={`w-full py-2 px-3 text-sm rounded transition-all flex items-center justify-between cursor-pointer ${
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
                className={`flex-1 py-2 text-sm rounded font-mono transition-all cursor-pointer ${
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
