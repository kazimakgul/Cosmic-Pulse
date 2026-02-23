/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useGameStore, Territory } from '../store/useGameStore';

export function Territories() {
  const territories = useGameStore(state => state.territories);

  return (
    <group>
      {Object.values(territories).map(t => (
        <TerritoryNode key={t.id} territory={t} />
      ))}
    </group>
  );
}

function TerritoryNode({ territory }: { territory: Territory }) {
  const color = territory.controllingColor || '#444444';
  const points = territory.points;
  const isCaptured = points >= 100;
  
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.5;
      meshRef.current.rotation.x += delta * 0.2;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z -= delta * 0.3;
    }
  });

  return (
    <group position={[territory.position.x, territory.position.y, territory.position.z]}>
      {/* Core Sphere */}
      <Sphere ref={meshRef} args={[territory.radius * 0.8, 32, 32]}>
        <meshStandardMaterial 
          color={color} 
          transparent 
          opacity={isCaptured ? 0.9 : 0.4 + (points / 100) * 0.4} 
          wireframe={!isCaptured}
          emissive={color}
          emissiveIntensity={isCaptured ? 0.8 : (points / 100) * 0.5}
        />
      </Sphere>

      {/* Outer Ring */}
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[territory.radius, 0.1, 16, 64]} />
        <meshStandardMaterial 
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
          transparent
          opacity={0.8}
        />
      </mesh>

      {/* Capture Progress Text */}
      <Text
        position={[0, territory.radius + 1, 0]}
        fontSize={1}
        color={color}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.05}
        outlineColor="#000000"
      >
        {Math.floor(points)}%
      </Text>
    </group>
  );
}
