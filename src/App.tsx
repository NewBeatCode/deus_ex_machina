"use client";

import { useState } from "react";
import { SettingsModal } from "../components/live/SettingsModal";
import { UnifiedVisionWrapper } from "../components/live/UnifiedVisionWrapper";

export default function VisionPage() {
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({
    gridSize: 2,
    seed: "Random",
    objectDetection: false,
  });

  return (
    <main className="relative w-full h-screen bg-black">
      <UnifiedVisionWrapper settings={settings} />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        settings={settings}
        onUpdate={setSettings}
      />

      {/* Settings Trigger Icon (Bottom Right) */}
      <button
        onClick={() => setShowSettings(true)}
        className="fixed bottom-6 right-6 z-150 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-all backdrop-blur-sm group"
      />
    </main>
  );
}
