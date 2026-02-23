/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { create } from 'zustand';

export type Vector3 = { x: number; y: number; z: number };
export type AbilityType = 'attractor' | 'repulsor';

export interface Player {
  id: string;
  color: string;
  position: Vector3 | null;
}

export interface ForceField {
  id: string;
  position: Vector3;
  type: AbilityType;
  ownerId: string;
  createdAt: number;
  color: string;
}

export interface Territory {
  id: string;
  position: Vector3;
  radius: number;
  points: number;
  controllingColor: string | null;
}

export interface AbilityConfig {
  energyCost: number;
  cooldownMs: number;
}

interface Cooldowns {
  attractor: number;
  repulsor: number;
}

interface GameState {
  myId: string | null;
  myColor: string | null;
  players: Record<string, Player>;
  forceFields: Record<string, ForceField>;
  territories: Record<string, Territory>;
  myEnergy: number;
  myMaxEnergy: number;
  myRegenPerSecond: number;
  myCooldowns: Cooldowns;
  lastActionRejectedReason: string | null;
  abilityConfig: Record<AbilityType, AbilityConfig>;
  maxActiveForceFieldsPerPlayer: number;
  ws: WebSocket | null;
  connect: () => void;
  disconnect: () => void;
  sendCursor: (position: Vector3) => void;
  addForce: (position: Vector3, type: AbilityType) => void;
  canUseAbility: (type: AbilityType, atMs?: number) => boolean;
  getAbilityRemainingCooldownMs: (type: AbilityType, atMs?: number) => number;
  hitTerritory: (territoryId: string, amount: number) => void;
}

const DEFAULT_ABILITY_CONFIG: Record<AbilityType, AbilityConfig> = {
  attractor: { energyCost: 25, cooldownMs: 1200 },
  repulsor: { energyCost: 35, cooldownMs: 1800 }
};

const DEFAULT_COOLDOWNS: Cooldowns = {
  attractor: 0,
  repulsor: 0
};

export const useGameStore = create<GameState>((set, get) => ({
  myId: null,
  myColor: null,
  players: {},
  forceFields: {},
  territories: {},
  myEnergy: 0,
  myMaxEnergy: 100,
  myRegenPerSecond: 20,
  myCooldowns: DEFAULT_COOLDOWNS,
  lastActionRejectedReason: null,
  abilityConfig: DEFAULT_ABILITY_CONFIG,
  maxActiveForceFieldsPerPlayer: 4,
  ws: null,

  connect: () => {
    const { ws: currentWs } = get();
    if (currentWs && (currentWs.readyState === WebSocket.CONNECTING || currentWs.readyState === WebSocket.OPEN)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}`);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'init') {
        set({
          myId: data.id,
          myColor: data.color,
          abilityConfig: data.abilityConfig ?? DEFAULT_ABILITY_CONFIG,
          maxActiveForceFieldsPerPlayer: data.maxActiveForceFieldsPerPlayer ?? 4
        });
        const playersMap: Record<string, Player> = {};
        data.players.forEach((p: Player) => {
          if (p.id !== data.id) playersMap[p.id] = p;
        });

        const me = data.players.find((p: any) => p.id === data.id);

        const forcesMap: Record<string, ForceField> = {};
        data.forceFields.forEach((f: ForceField) => {
          forcesMap[f.id] = f;
        });

        const terrMap: Record<string, Territory> = {};
        if (data.territories) {
          data.territories.forEach((t: Territory) => {
            terrMap[t.id] = t;
          });
        }

        set({
          players: playersMap,
          forceFields: forcesMap,
          territories: terrMap,
          myEnergy: me?.energy ?? 0,
          myMaxEnergy: me?.maxEnergy ?? 100,
          myRegenPerSecond: me?.regenPerSecond ?? 20,
          myCooldowns: me?.cooldowns ?? DEFAULT_COOLDOWNS,
          lastActionRejectedReason: null
        });
      } else if (data.type === 'player_joined') {
        set((state) => ({
          players: { ...state.players, [data.player.id]: data.player }
        }));
      } else if (data.type === 'player_left') {
        set((state) => {
          const newPlayers = { ...state.players };
          delete newPlayers[data.id];
          return { players: newPlayers };
        });
      } else if (data.type === 'sync') {
        set((state) => {
          const newPlayers = { ...state.players };
          data.players.forEach((p: Player) => {
            if (p.id !== state.myId) {
              newPlayers[p.id] = { ...newPlayers[p.id], position: p.position };
            }
          });

          let newForces = state.forceFields;
          if (data.forceFields) {
            newForces = {};
            data.forceFields.forEach((f: ForceField) => {
              newForces[f.id] = f;
            });
          }

          let newTerritories = state.territories;
          if (data.territories) {
            newTerritories = {};
            data.territories.forEach((t: Territory) => {
              newTerritories[t.id] = t;
            });
          }

          const myStats = data.playerStats?.find((stats: any) => stats.id === state.myId);

          return {
            players: newPlayers,
            forceFields: newForces,
            territories: newTerritories,
            ...(myStats
              ? {
                  myEnergy: myStats.energy,
                  myMaxEnergy: myStats.maxEnergy,
                  myRegenPerSecond: myStats.regenPerSecond,
                  myCooldowns: myStats.cooldowns
                }
              : {})
          };
        });
      } else if (data.type === 'force_added') {
        set((state) => ({
          forceFields: { ...state.forceFields, [data.force.id]: data.force },
          lastActionRejectedReason: null
        }));
      } else if (data.type === 'action_rejected') {
        set({ lastActionRejectedReason: data.reason ?? 'rejected' });
      }
    };

    ws.onclose = () => {
      // Only auto-reconnect if we didn't intentionally disconnect
      const { ws: currentWs } = get();
      if (currentWs === ws) {
        setTimeout(() => get().connect(), 1000);
      }
    };

    set({ ws });
  },

  disconnect: () => {
    const { ws } = get();
    if (ws) {
      ws.close();
      set({
        ws: null,
        players: {},
        forceFields: {},
        territories: {},
        myEnergy: 0,
        myMaxEnergy: 100,
        myRegenPerSecond: 20,
        myCooldowns: DEFAULT_COOLDOWNS,
        lastActionRejectedReason: null
      });
    }
  },

  sendCursor: (position: Vector3) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cursor', position }));
    }
  },

  addForce: (position: Vector3, type: AbilityType) => {
    const { ws, myColor } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'add_force', position, forceType: type, color: myColor }));
    }
  },

  canUseAbility: (type: AbilityType, atMs = Date.now()) => {
    const { myEnergy, myCooldowns, abilityConfig } = get();
    const config = abilityConfig[type];
    if (!config) {
      return false;
    }
    return myEnergy >= config.energyCost && myCooldowns[type] <= atMs;
  },

  getAbilityRemainingCooldownMs: (type: AbilityType, atMs = Date.now()) => {
    const { myCooldowns } = get();
    return Math.max(0, myCooldowns[type] - atMs);
  },

  hitTerritory: (territoryId: string, amount: number) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'hit_territory', territoryId, amount }));
    }
  }
}));
