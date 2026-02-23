/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { create } from 'zustand';

export type Vector3 = { x: number; y: number; z: number };

export interface Player {
  id: string;
  color: string;
  position: Vector3 | null;
}

export interface ForceField {
  id: string;
  position: Vector3;
  type: 'attractor' | 'repulsor';
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

export type GamePhase = 'lobby' | 'countdown' | 'in_match' | 'post_match';

export interface Scoreboard {
  players: Record<string, number>;
  colors: Record<string, number>;
}

export interface MatchMetadata {
  phase: GamePhase;
  roundEndsAt: number | null;
  winningPlayerId: string | null;
  winningColor: string | null;
  scoreboard: Scoreboard;
}

interface GameState {
  myId: string | null;
  myColor: string | null;
  players: Record<string, Player>;
  forceFields: Record<string, ForceField>;
  territories: Record<string, Territory>;
  phase: GamePhase;
  roundEndsAt: number | null;
  winningPlayerId: string | null;
  winningColor: string | null;
  scoreboard: Scoreboard;
  ws: WebSocket | null;
  connect: () => void;
  disconnect: () => void;
  sendCursor: (position: Vector3) => void;
  addForce: (position: Vector3, type: 'attractor' | 'repulsor') => void;
  hitTerritory: (territoryId: string, amount: number) => void;
}

export const useGameStore = create<GameState>((set, get) => ({
  myId: null,
  myColor: null,
  players: {},
  forceFields: {},
  territories: {},
  phase: 'lobby',
  roundEndsAt: null,
  winningPlayerId: null,
  winningColor: null,
  scoreboard: { players: {}, colors: {} },
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
        set({ myId: data.id, myColor: data.color });
        const playersMap: Record<string, Player> = {};
        data.players.forEach((p: Player) => {
          if (p.id !== data.id) playersMap[p.id] = p;
        });
        
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
          phase: data.match?.phase ?? 'lobby',
          roundEndsAt: data.match?.roundEndsAt ?? null,
          winningPlayerId: data.match?.winningPlayerId ?? null,
          winningColor: data.match?.winningColor ?? null,
          scoreboard: data.match?.scoreboard ?? { players: {}, colors: {} }
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
          
          return {
            players: newPlayers,
            forceFields: newForces,
            territories: newTerritories,
            phase: data.match?.phase ?? state.phase,
            roundEndsAt: data.match?.roundEndsAt ?? state.roundEndsAt,
            winningPlayerId: data.match?.winningPlayerId ?? state.winningPlayerId,
            winningColor: data.match?.winningColor ?? state.winningColor,
            scoreboard: data.match?.scoreboard ?? state.scoreboard
          };
        });
      } else if (data.type === 'force_added') {
        set((state) => ({
          forceFields: { ...state.forceFields, [data.force.id]: data.force }
        }));
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
        phase: 'lobby',
        roundEndsAt: null,
        winningPlayerId: null,
        winningColor: null,
        scoreboard: { players: {}, colors: {} }
      });
    }
  },

  sendCursor: (position: Vector3) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'cursor', position }));
    }
  },

  addForce: (position: Vector3, type: 'attractor' | 'repulsor') => {
    const { ws, myColor } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'add_force', position, forceType: type, color: myColor }));
    }
  },

  hitTerritory: (territoryId: string, amount: number) => {
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'hit_territory', territoryId, amount }));
    }
  }
}));
