/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useMemo, useState } from 'react';
import { CosmicCanvas } from './components/CosmicCanvas';
import { useGameStore } from './store/useGameStore';
import { Users } from 'lucide-react';

function AbilityChip({
  label,
  hotkey,
  cooldownMs,
  totalCooldownMs,
  ready
}: {
  label: string;
  hotkey: string;
  cooldownMs: number;
  totalCooldownMs: number;
  ready: boolean;
}) {
  const progress = totalCooldownMs > 0 ? Math.min(1, cooldownMs / totalCooldownMs) : 0;
  const remainingSeconds = Math.max(0, cooldownMs / 1000);

  return (
    <div className="relative flex items-center gap-2 px-3 py-2 rounded-lg border border-white/15 bg-black/40 min-w-32 overflow-hidden">
      {!ready && (
        <div
          className="absolute inset-0 bg-white/10"
          style={{ clipPath: `inset(${(1 - progress) * 100}% 0 0 0)` }}
        />
      )}
      <div className="relative z-10 h-6 w-6 rounded-full border border-white/40 flex items-center justify-center text-[10px] font-bold text-cyan-300">
        {hotkey}
      </div>
      <div className="relative z-10 flex flex-col leading-tight">
        <span className="text-xs uppercase tracking-wide text-gray-300">{label}</span>
        <span className={`text-[11px] ${ready ? 'text-emerald-300' : 'text-amber-300'}`}>
          {ready ? 'Ready' : `${remainingSeconds.toFixed(1)}s`}
        </span>
      </div>
    </div>
  );
}

export default function App() {
  const connect = useGameStore((state) => state.connect);
  const disconnect = useGameStore((state) => state.disconnect);
  const players = useGameStore((state) => state.players);
  const myColor = useGameStore((state) => state.myColor);
  const myEnergy = useGameStore((state) => state.myEnergy);
  const myMaxEnergy = useGameStore((state) => state.myMaxEnergy);
  const abilityConfig = useGameStore((state) => state.abilityConfig);
  const getAbilityRemainingCooldownMs = useGameStore((state) => state.getAbilityRemainingCooldownMs);

  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, []);

  const playerCount = Object.keys(players).length + 1;
  const energyPercent = useMemo(() => {
    if (myMaxEnergy <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, (myEnergy / myMaxEnergy) * 100));
  }, [myEnergy, myMaxEnergy]);

  const attractorCooldown = getAbilityRemainingCooldownMs('attractor', now);
  const repulsorCooldown = getAbilityRemainingCooldownMs('repulsor', now);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black text-white font-sans">
      <CosmicCanvas />

      {/* UI Overlay */}
      <div className="absolute top-0 left-0 w-full p-6 pointer-events-none flex justify-between items-start z-10">
        <div className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
            Territory War
          </h1>
          <p className="text-sm text-gray-400 max-w-xs leading-relaxed">
            Move cursor to spawn particles.<br/>
            Direct particles into territories to capture them.<br/>
            <span className="text-white font-medium">Left click</span> to place an attractor.<br/>
            <span className="text-white font-medium">Spacebar</span> to place a repulsor.
          </p>

          {myColor && (
            <div className="flex items-center gap-2 mt-2">
              <div className="w-3 h-3 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.5)]" style={{ backgroundColor: myColor }} />
              <span className="text-xs text-gray-400 uppercase tracking-wider">Your Color</span>
            </div>
          )}

          <div className="pointer-events-auto mt-2 max-w-sm rounded-xl border border-white/15 bg-black/45 backdrop-blur-md p-3 space-y-3">
            <div>
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-gray-300 mb-1">
                <span>Energy</span>
                <span>{Math.round(myEnergy)} / {Math.round(myMaxEnergy)}</span>
              </div>
              <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 transition-[width] duration-100"
                  style={{ width: `${energyPercent}%` }}
                />
              </div>
            </div>

            <div className="flex gap-2">
              <AbilityChip
                label="Attractor"
                hotkey="LMB"
                cooldownMs={attractorCooldown}
                totalCooldownMs={abilityConfig.attractor.cooldownMs}
                ready={attractorCooldown <= 0}
              />
              <AbilityChip
                label="Repulsor"
                hotkey="Space"
                cooldownMs={repulsorCooldown}
                totalCooldownMs={abilityConfig.repulsor.cooldownMs}
                ready={repulsorCooldown <= 0}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-4 pointer-events-auto">
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-lg">
            <Users size={16} className="text-cyan-400" />
            <span className="text-sm font-medium">{playerCount} {playerCount === 1 ? 'Player' : 'Players'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
