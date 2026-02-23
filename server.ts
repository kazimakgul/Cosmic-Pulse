/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import http from 'http';

const PORT = 3000;

// Types
type Vector3 = { x: number; y: number; z: number };

interface Player {
  id: string;
  color: string;
  position: Vector3 | null;
  lastUpdate: number;
}

interface ForceField {
  id: string;
  position: Vector3;
  type: 'attractor' | 'repulsor';
  ownerId: string;
  createdAt: number;
  color: string;
}

interface Territory {
  id: string;
  position: Vector3;
  radius: number;
  points: number; // 0 to 100
  controllingColor: string | null;
}

type GamePhase = 'lobby' | 'countdown' | 'in_match' | 'post_match';

interface Scoreboard {
  players: Record<string, number>;
  colors: Record<string, number>;
}

interface MatchMetadata {
  phase: GamePhase;
  roundEndsAt: number | null;
  winningPlayerId: string | null;
  winningColor: string | null;
  scoreboard: Scoreboard;
}

// State
const players = new Map<string, Player>();
const forceFields = new Map<string, ForceField>();
const clients = new Map<string, WebSocket>();

const territories = new Map<string, Territory>([
  ['t1', { id: 't1', position: { x: -8, y: 4, z: 0 }, radius: 2.5, points: 0, controllingColor: null }],
  ['t2', { id: 't2', position: { x: 8, y: 4, z: 0 }, radius: 2.5, points: 0, controllingColor: null }],
  ['t3', { id: 't3', position: { x: 0, y: -6, z: 0 }, radius: 2.5, points: 0, controllingColor: null }],
]);

// Colors for players
const COLORS = [
  '#FF3366', '#33CCFF', '#FF9933', '#33FF99', 
  '#CC33FF', '#FFFF33', '#FF3333', '#3333FF'
];

function getNextPlayerColor() {
  const usedColors = new Set(Array.from(players.values()).map((p) => p.color));
  const availableColor = COLORS.find((color) => !usedColors.has(color));
  if (availableColor) {
    return availableColor;
  }
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

const COUNTDOWN_DURATION_MS = 5000;
const MATCH_DURATION_MS = 45000;
const POST_MATCH_DURATION_MS = 5000;

const matchMetadata: MatchMetadata = {
  phase: 'lobby',
  roundEndsAt: null,
  winningPlayerId: null,
  winningColor: null,
  scoreboard: {
    players: {},
    colors: {},
  }
};

function serializeMatchMetadata(): MatchMetadata {
  return {
    phase: matchMetadata.phase,
    roundEndsAt: matchMetadata.roundEndsAt,
    winningPlayerId: matchMetadata.winningPlayerId,
    winningColor: matchMetadata.winningColor,
    scoreboard: {
      players: { ...matchMetadata.scoreboard.players },
      colors: { ...matchMetadata.scoreboard.colors },
    }
  };
}

function resetRoundState() {
  for (const territory of territories.values()) {
    territory.points = 0;
    territory.controllingColor = null;
  }
  forceFields.clear();
}

function startCountdown(now: number) {
  matchMetadata.phase = 'countdown';
  matchMetadata.roundEndsAt = now + COUNTDOWN_DURATION_MS;
  matchMetadata.winningPlayerId = null;
  matchMetadata.winningColor = null;
}

function startMatch(now: number) {
  matchMetadata.phase = 'in_match';
  matchMetadata.roundEndsAt = now + MATCH_DURATION_MS;
}

function getWinningPlayerByColor(color: string): Player | null {
  for (const player of players.values()) {
    if (player.color === color) {
      return player;
    }
  }
  return null;
}

function endMatch(now: number) {
  const territoryCounts: Record<string, number> = {};
  const territoryPoints: Record<string, number> = {};

  for (const territory of territories.values()) {
    if (!territory.controllingColor) {
      continue;
    }

    const color = territory.controllingColor;
    territoryCounts[color] = (territoryCounts[color] || 0) + 1;
    territoryPoints[color] = (territoryPoints[color] || 0) + territory.points;
  }

  let winningColor: string | null = null;
  let bestTerritoryCount = -1;
  let bestTotalPoints = -1;

  for (const color of Object.keys(territoryCounts)) {
    const count = territoryCounts[color] || 0;
    const points = territoryPoints[color] || 0;

    if (count > bestTerritoryCount || (count === bestTerritoryCount && points > bestTotalPoints)) {
      winningColor = color;
      bestTerritoryCount = count;
      bestTotalPoints = points;
    }
  }

  const winningPlayer = winningColor ? getWinningPlayerByColor(winningColor) : null;

  matchMetadata.phase = 'post_match';
  matchMetadata.roundEndsAt = now + POST_MATCH_DURATION_MS;
  matchMetadata.winningColor = winningColor;
  matchMetadata.winningPlayerId = winningPlayer?.id || null;

  if (winningColor) {
    matchMetadata.scoreboard.colors[winningColor] = (matchMetadata.scoreboard.colors[winningColor] || 0) + 1;
  }

  if (winningPlayer) {
    matchMetadata.scoreboard.players[winningPlayer.id] = (matchMetadata.scoreboard.players[winningPlayer.id] || 0) + 1;
  }
}

function updateMatchPhase(now: number) {
  if (players.size === 0) {
    matchMetadata.phase = 'lobby';
    matchMetadata.roundEndsAt = null;
    matchMetadata.winningPlayerId = null;
    matchMetadata.winningColor = null;
    return;
  }

  if (matchMetadata.phase === 'lobby') {
    resetRoundState();
    startCountdown(now);
    return;
  }

  if (!matchMetadata.roundEndsAt || now < matchMetadata.roundEndsAt) {
    return;
  }

  if (matchMetadata.phase === 'countdown') {
    startMatch(now);
  } else if (matchMetadata.phase === 'in_match') {
    endMatch(now);
  } else if (matchMetadata.phase === 'post_match') {
    resetRoundState();
    startCountdown(now);
  }
}

function broadcast(data: any, excludeId?: string) {
  const message = JSON.stringify(data);
  for (const [id, ws] of clients.entries()) {
    if (id !== excludeId && ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  }
}

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  
  // WebSocket Server
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    const id = uuidv4();
    const color = getNextPlayerColor();
    
    const player: Player = {
      id,
      color,
      position: null,
      lastUpdate: Date.now()
    };
    
    players.set(id, player);
    clients.set(id, ws);

    // Send initial state to the new client
    ws.send(JSON.stringify({
      type: 'init',
      id,
      color,
      players: Array.from(players.values()),
      forceFields: Array.from(forceFields.values()),
      territories: Array.from(territories.values()),
      match: serializeMatchMetadata()
    }));

    // Broadcast new player to others
    broadcast({
      type: 'player_joined',
      player
    }, id);

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'cursor') {
          const p = players.get(id);
          if (p) {
            p.position = data.position;
            p.lastUpdate = Date.now();
          }
        } else if (data.type === 'add_force') {
          const forceId = uuidv4();
          const force: ForceField = {
            id: forceId,
            position: data.position,
            type: data.forceType,
            ownerId: id,
            createdAt: Date.now(),
            color: data.color
          };
          forceFields.set(forceId, force);
          
          // Broadcast new force field immediately
          broadcast({
            type: 'force_added',
            force
          });
        } else if (data.type === 'hit_territory') {
          if (matchMetadata.phase !== 'in_match') {
            return;
          }
          const t = territories.get(data.territoryId);
          const p = players.get(id);
          if (t && p) {
            const amount = data.amount * 0.1; // scale down hits
            if (t.controllingColor === p.color) {
              t.points = Math.min(100, t.points + amount);
            } else {
              t.points -= amount;
              if (t.points <= 0) {
                t.controllingColor = p.color;
                t.points = Math.abs(t.points);
              }
            }
          }
        }
      } catch (e) {
        console.error('Invalid message', e);
      }
    });

    ws.on('close', () => {
      players.delete(id);
      clients.delete(id);
      
      // Remove player's force fields
      for (const [forceId, force] of forceFields.entries()) {
        if (force.ownerId === id) {
          forceFields.delete(forceId);
        }
      }

      broadcast({
        type: 'player_left',
        id
      });
    });
  });

  // Broadcast loop (20Hz)
  setInterval(() => {
    const now = Date.now();
    updateMatchPhase(now);
    
    // Clean up old force fields (e.g., after 10.5 seconds to allow client animation)
    let forcesChanged = false;
    for (const [id, force] of forceFields.entries()) {
      if (now - force.createdAt > 10500) {
        forceFields.delete(id);
        forcesChanged = true;
      }
    }

    const updateData = {
      type: 'sync',
      players: Array.from(players.values()).filter(p => p.position !== null),
      territories: Array.from(territories.values()),
      match: serializeMatchMetadata(),
      ...(forcesChanged ? { forceFields: Array.from(forceFields.values()) } : {})
    };

    broadcast(updateData);
  }, 50);

  // API routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', players: players.size });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
