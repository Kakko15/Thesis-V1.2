import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useIsDark } from '../../hooks/useIsDark'
import { useSceneRuntime } from './useSceneRuntime'
import { makeGlowTexture, mulberry32 } from './constellation'

/**
 * Normalizes stage string/label to canonical 7 pipeline stage keys.
 */
function normalizeStageKey(keyOrLabel) {
  if (!keyOrLabel) return 'download'
  const s = String(keyOrLabel).toLowerCase().trim()
  if (s.includes('malware') || s === 'malware_scan') return 'malware_scan'
  if (s.includes('extract') || s.includes('clean') || s === 'extract') return 'extract'
  if (s.includes('chunk')) return 'chunk'
  if (s.includes('embed')) return 'embed'
  if (s.includes('screen') || s.includes('novelty')) return 'screen'
  if (s.includes('index') || s.includes('complete') || s.includes('finish')) return 'index'
  return 'download'
}

const PHASE_CONFIGS = {
  download: {
    badge: 'PHASE 01 // SECURE SOURCE INGESTION',
    spec: 'AES-256 GCM ENCRYPTED STREAM',
    action: 'Materializing manuscript into isolated staging vault',
    accent: '#34d388',
  },
  malware_scan: {
    badge: 'PHASE 02 // BIOMETRIC MALWARE SCAN',
    spec: 'CLAMAV HEURISTIC RADAR ACTIVE',
    action: 'Scanning PDF streams for malicious zero-day payloads',
    accent: '#10b96c',
  },
  extract: {
    badge: 'PHASE 03 // PYMUPDF + TESSERACT OCR',
    spec: 'STRUCTURAL LAYER EXTRACTION',
    action: 'Peeling headers, footers & stripping document noise',
    accent: '#f2a900',
  },
  chunk: {
    badge: 'PHASE 04 // 800-TOKEN SEMANTIC SLICING',
    spec: '100-TOKEN OVERLAP ACCORDION',
    action: 'Dissecting text into overlapping semantic windows',
    accent: '#38bdf8',
  },
  embed: {
    badge: 'PHASE 05 // 768D NEURAL SYNAPSE EMBED',
    spec: 'GEMINI EMBEDDING 001 ENGINE',
    action: 'Transforming semantic chunks into 768-dimensional coordinates',
    accent: '#f59e0b',
  },
  screen: {
    badge: 'PHASE 06 // ARCHIVE NOVELTY SCREENING',
    spec: 'COSINE SIMILARITY MATRIX 85%',
    action: 'Comparing vector coordinates against entire departmental archive',
    accent: '#ec4899',
  },
  index: {
    badge: 'PHASE 07 // PGVECTOR STORAGE MATRIX',
    spec: 'HNSW VECTOR VAULT PERSISTED',
    action: 'Committing 768d vectors into pgvector semantic index',
    accent: '#10b96c',
  },
}

/**
 * Base holographic manuscript document floating in 3D space.
 */
function HolographicDocument({ isDark, activeStageKey }) {
  const docRef = useRef(null)

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (docRef.current) {
      docRef.current.position.y = Math.sin(t * 1.5) * 0.05
      docRef.current.rotation.y = Math.sin(t * 0.7) * 0.08
      docRef.current.rotation.z = Math.cos(t * 1.0) * 0.02
    }
  })

  const emeraldColor = isDark ? '#34d388' : '#059656'
  const goldColor = isDark ? '#fde68a' : '#f2a900'

  // During chunking, the document is replaced by the 5 sliding chunks
  if (activeStageKey === 'chunk') return null

  return (
    <group ref={docRef} position={[0, 0, 0]}>
      {/* Translucent document body */}
      <mesh>
        <planeGeometry args={[1.25, 1.75, 1, 1]} />
        <meshPhysicalMaterial
          color={isDark ? '#064e30' : '#d1fae1'}
          transparent
          opacity={isDark ? 0.32 : 0.42}
          roughness={0.2}
          transmission={0.6}
          thickness={0.4}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Illuminated perimeter frame */}
      <lineSegments>
        <edgesGeometry args={[new THREE.PlaneGeometry(1.25, 1.75)]} />
        <lineBasicMaterial color={emeraldColor} transparent opacity={0.65} linewidth={1.5} />
      </lineSegments>

      {/* Abstract document text content lines */}
      {[-0.55, -0.4, -0.25, -0.1, 0.05, 0.2, 0.35, 0.5, 0.65].map((y, idx) => (
        <mesh key={idx} position={[idx % 2 === 0 ? 0 : -0.08, y, 0.01]}>
          <planeGeometry args={[idx % 2 === 0 ? 0.9 : 0.7, 0.035]} />
          <meshBasicMaterial
            color={idx === 0 || idx === 8 ? goldColor : emeraldColor}
            transparent
            opacity={isDark ? 0.4 : 0.5}
          />
        </mesh>
      ))}
    </group>
  )
}

/* =========================================================================
   STAGE 1: SECURE SOURCE (Download / Staging Vault)
   ========================================================================= */
function StageSecureSource({ active, isDark }) {
  const groupRef = useRef(null)
  const particlesRef = useRef(null)
  const lockRingRef = useRef(null)
  const count = 45

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const rand = mulberry32(111)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * 2.0
      pos[i * 3 + 1] = rand() * 2.4
      pos[i * 3 + 2] = (rand() - 0.5) * 1.4
    }
    return pos
  }, [count])

  useFrame(({ clock }, dt) => {
    if (!groupRef.current) return
    const targetScale = active ? 1 : 0.001
    groupRef.current.scale.setScalar(THREE.MathUtils.damp(groupRef.current.scale.x, targetScale, 6, dt))
    groupRef.current.visible = groupRef.current.scale.x > 0.01

    if (active) {
      const t = clock.getElapsedTime()
      if (lockRingRef.current) lockRingRef.current.rotation.z = t * 1.2
      if (particlesRef.current) {
        const arr = particlesRef.current.geometry.attributes.position.array
        for (let i = 0; i < count; i++) {
          arr[i * 3 + 1] -= dt * 1.8
          if (arr[i * 3 + 1] < -1.1) arr[i * 3 + 1] = 1.8
        }
        particlesRef.current.geometry.attributes.position.needsUpdate = true
      }
    }
  })

  const emerald = isDark ? '#34d388' : '#059656'
  const gold = isDark ? '#ffc72c' : '#d97706'

  return (
    <group ref={groupRef} scale={[0.001, 0.001, 0.001]}>
      {/* 3D Vault Wireframe Enclosure */}
      <mesh>
        <boxGeometry args={[1.5, 2.0, 0.8]} />
        <meshBasicMaterial color={emerald} transparent opacity={0.15} wireframe />
      </mesh>

      {/* Cybernetic Vault Corner Brackets */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(1.5, 2.0, 0.8)]} />
        <lineBasicMaterial color={emerald} transparent opacity={0.6} />
      </lineSegments>

      {/* Rotating Security Lock Rings */}
      <group ref={lockRingRef} position={[0, 0, 0.42]}>
        <mesh>
          <ringGeometry args={[0.26, 0.3, 32]} />
          <meshBasicMaterial color={gold} transparent opacity={0.8} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0, 0.01]}>
          <circleGeometry args={[0.12, 16]} />
          <meshBasicMaterial color={emerald} transparent opacity={0.7} />
        </mesh>
      </group>

      {/* Streaming Ingestion Packets */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial color={gold} size={0.065} transparent opacity={0.85} depthWrite={false} />
      </points>
    </group>
  )
}

/* =========================================================================
   STAGE 2: MALWARE SCAN (Real-Time Radar & Laser Sweeper)
   ========================================================================= */
function StageMalwareScan({ active, isDark }) {
  const groupRef = useRef(null)
  const laserBarRef = useRef(null)
  const radarWaveRef = useRef(null)
  const gridPlaneRef = useRef(null)

  useFrame(({ clock }, dt) => {
    if (!groupRef.current) return
    const targetScale = active ? 1 : 0.001
    groupRef.current.scale.setScalar(THREE.MathUtils.damp(groupRef.current.scale.x, targetScale, 6, dt))
    groupRef.current.visible = groupRef.current.scale.x > 0.01

    if (active) {
      const t = clock.getElapsedTime()
      // Laser travels up and down the scanning bed
      const laserY = Math.sin(t * 3.2) * 0.75
      if (laserBarRef.current) laserBarRef.current.position.y = laserY

      // Concentric radar scan wave expands
      if (radarWaveRef.current) {
        const s = ((t * 1.1) % 1) * 1.8 + 0.2
        radarWaveRef.current.scale.set(s, s, 1)
        radarWaveRef.current.material.opacity = (1 - ((t * 1.1) % 1)) * 0.7
      }
      if (gridPlaneRef.current) {
        gridPlaneRef.current.material.opacity = 0.25 + Math.sin(t * 6) * 0.1
      }
    }
  })

  const emerald = isDark ? '#10b96c' : '#059656'
  const brightGreen = isDark ? '#34d388' : '#10b96c'

  return (
    <group ref={groupRef} scale={[0.001, 0.001, 0.001]} position={[0, 0, 0.05]}>
      {/* 3D Scanning Grid across paper bed */}
      <mesh ref={gridPlaneRef} position={[0, 0, 0.01]}>
        <planeGeometry args={[1.2, 1.7, 10, 14]} />
        <meshBasicMaterial color={brightGreen} wireframe transparent opacity={0.3} />
      </mesh>

      {/* Sweeping Laser Scan Bar */}
      <group ref={laserBarRef} position={[0, 0, 0.04]}>
        <mesh>
          <cylinderGeometry args={[0.02, 0.02, 1.35, 16]} rotation={[0, 0, Math.PI / 2]} />
          <meshBasicMaterial color={brightGreen} />
        </mesh>
        <pointLight color={brightGreen} intensity={1.5} distance={1.2} />
      </group>

      {/* Expanding Antivirus Sonar Ring */}
      <mesh ref={radarWaveRef} position={[0, 0, 0.03]}>
        <ringGeometry args={[0.7, 0.74, 48]} />
        <meshBasicMaterial color={emerald} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* Floating 3D Shield Emblem */}
      <group position={[0, 0, 0.35]}>
        <mesh rotation={[0, 0, Math.PI / 6]}>
          <cylinderGeometry args={[0.3, 0.3, 0.02, 6]} />
          <meshBasicMaterial color={emerald} transparent opacity={0.35} wireframe />
        </mesh>
      </group>
    </group>
  )
}

/* =========================================================================
   STAGE 3: EXTRACT & CLEAN (Text Peeling & Noise Debris Dissolution)
   ========================================================================= */
function StageExtractClean({ active, isDark }) {
  const groupRef = useRef(null)
  const debrisRef = useRef(null)
  const debrisCount = 30

  const debrisPositions = useMemo(() => {
    const pos = new Float32Array(debrisCount * 3)
    const rand = mulberry32(333)
    for (let i = 0; i < debrisCount; i++) {
      pos[i * 3] = (rand() - 0.5) * 1.6
      pos[i * 3 + 1] = (rand() - 0.5) * 1.8
      pos[i * 3 + 2] = rand() * 0.8
    }
    return pos
  }, [debrisCount])

  useFrame(({ clock }, dt) => {
    if (!groupRef.current) return
    const targetScale = active ? 1 : 0.001
    groupRef.current.scale.setScalar(THREE.MathUtils.damp(groupRef.current.scale.x, targetScale, 6, dt))
    groupRef.current.visible = groupRef.current.scale.x > 0.01

    if (active) {
      const t = clock.getElapsedTime()
      // Floating extracted paragraphs peeling upwards off paper in 3D parallax
      if (groupRef.current.children[0]) {
        groupRef.current.children[0].children.forEach((slab, i) => {
          slab.position.z = 0.15 + i * 0.09 + Math.sin(t * 2 + i) * 0.03
          slab.position.x = Math.sin(t * 1.2 + i) * 0.02
        })
      }
      // Noise/boilerplate debris disintegrating outward
      if (debrisRef.current) {
        const arr = debrisRef.current.geometry.attributes.position.array
        for (let i = 0; i < debrisCount; i++) {
          arr[i * 3] += (arr[i * 3] > 0 ? 1 : -1) * dt * 0.8
          arr[i * 3 + 2] += dt * 0.6
          if (Math.abs(arr[i * 3]) > 1.8) {
            arr[i * 3] = (Math.random() - 0.5) * 0.4
            arr[i * 3 + 2] = 0.1
          }
        }
        debrisRef.current.geometry.attributes.position.needsUpdate = true
      }
    }
  })

  const gold = isDark ? '#ffc72c' : '#f2a900'
  const emerald = isDark ? '#34d388' : '#059656'

  return (
    <group ref={groupRef} scale={[0.001, 0.001, 0.001]}>
      {/* Extracted Structured Paragraph Slabs floating in 3D */}
      <group>
        {[-0.45, -0.15, 0.15, 0.45].map((y, idx) => (
          <mesh key={idx} position={[0, y, 0.15 + idx * 0.05]}>
            <boxGeometry args={[1.05, 0.22, 0.02]} />
            <meshPhysicalMaterial
              color={idx % 2 === 0 ? gold : emerald}
              transparent
              opacity={0.7}
              roughness={0.2}
              transmission={0.4}
            />
          </mesh>
        ))}
      </group>

      {/* Disintegrating Boilers/Header Noise Particles */}
      <points ref={debrisRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[debrisPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial color={isDark ? '#f87171' : '#dc2626'} size={0.045} transparent opacity={0.65} />
      </points>
    </group>
  )
}

/* =========================================================================
   STAGE 4: CHUNK (3D Slicing Laser & Sliding Window Accordion)
   ========================================================================= */
function StageChunking({ active, isDark }) {
  const groupRef = useRef(null)
  const laserCutRef = useRef(null)

  useFrame(({ clock }, dt) => {
    if (!groupRef.current) return
    const targetScale = active ? 1 : 0.001
    groupRef.current.scale.setScalar(THREE.MathUtils.damp(groupRef.current.scale.x, targetScale, 6, dt))
    groupRef.current.visible = groupRef.current.scale.x > 0.01

    if (active) {
      const t = clock.getElapsedTime()
      // 5 chunks slide into an accordion fanned out in 3D space
      if (groupRef.current.children[0]) {
        groupRef.current.children[0].children.forEach((slab, i) => {
          const offset = i - 2
          slab.position.x = offset * 0.32 + Math.sin(t * 1.5 + i) * 0.02
          slab.position.y = offset * -0.18
          slab.position.z = 0.25 - Math.abs(offset) * 0.12 + Math.sin(t * 2 + i) * 0.03
          slab.rotation.y = offset * -0.15
        })
      }
      if (laserCutRef.current) {
        laserCutRef.current.position.x = Math.sin(t * 4) * 0.8
      }
    }
  })

  const cyan = isDark ? '#38bdf8' : '#0284c7'

  return (
    <group ref={groupRef} scale={[0.001, 0.001, 0.001]}>
      {/* 5 Distinct Sliding Chunk Cards */}
      <group>
        {[-2, -1, 0, 1, 2].map((idx) => (
          <group key={idx} position={[idx * 0.3, idx * -0.15, 0.2]}>
            <mesh>
              <boxGeometry args={[0.65, 0.42, 0.03]} />
              <meshPhysicalMaterial
                color={cyan}
                transparent
                opacity={0.65}
                roughness={0.2}
                transmission={0.5}
              />
            </mesh>
            <lineSegments>
              <edgesGeometry args={[new THREE.BoxGeometry(0.65, 0.42, 0.03)]} />
              <lineBasicMaterial color="#ffffff" transparent opacity={0.6} />
            </lineSegments>
          </group>
        ))}
      </group>

      {/* Slicing Laser Beam */}
      <group ref={laserCutRef} position={[0, 0, 0.35]}>
        <mesh>
          <cylinderGeometry args={[0.015, 0.015, 1.4, 12]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
        <pointLight color={cyan} intensity={1.8} distance={1.5} />
      </group>
    </group>
  )
}

/* =========================================================================
   STAGE 5: EMBED (768D Neural Constellation & Swirling Synapses)
   ========================================================================= */
function StageNeuralEmbed({ active, isDark, progress }) {
  const groupRef = useRef(null)
  const particlesRef = useRef(null)
  const coreRef = useRef(null)
  const count = 130

  const { positions, speeds, radii, angles, inclinations } = useMemo(() => {
    const rand = mulberry32(888)
    const pos = new Float32Array(count * 3)
    const spd = new Float32Array(count)
    const rad = new Float32Array(count)
    const ang = new Float32Array(count)
    const inc = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      rad[i] = 0.7 + rand() * 1.5
      ang[i] = rand() * Math.PI * 2
      inc[i] = (rand() - 0.5) * Math.PI * 0.95
      spd[i] = 1.0 + rand() * 1.4
    }
    return { positions: pos, speeds: spd, radii: rad, angles: ang, inclinations: inc }
  }, [count])

  const glowTexture = useMemo(() => makeGlowTexture(32), [])

  useFrame(({ clock }, dt) => {
    if (!groupRef.current) return
    const targetScale = active ? 1 : 0.001
    groupRef.current.scale.setScalar(THREE.MathUtils.damp(groupRef.current.scale.x, targetScale, 6, dt))
    groupRef.current.visible = groupRef.current.scale.x > 0.01

    if (active) {
      const t = clock.getElapsedTime()
      if (coreRef.current) {
        const s = 1 + Math.sin(t * 5) * 0.12 + (progress / 100) * 0.2
        coreRef.current.scale.set(s, s, s)
      }
      if (particlesRef.current) {
        const arr = particlesRef.current.geometry.attributes.position.array
        const rate = 1.6 + (progress / 100) * 1.5
        for (let i = 0; i < count; i++) {
          const theta = angles[i] + t * speeds[i] * rate
          const r = radii[i]
          const phi = inclinations[i]
          arr[i * 3] = Math.cos(theta) * r
          arr[i * 3 + 1] = Math.sin(phi) * 0.95 + Math.sin(theta * 3) * 0.22
          arr[i * 3 + 2] = Math.sin(theta) * r
        }
        particlesRef.current.geometry.attributes.position.needsUpdate = true
      }
    }
  })

  const gold = isDark ? '#ffc72c' : '#f2a900'
  const emerald = isDark ? '#34d388' : '#059656'

  return (
    <group ref={groupRef} scale={[0.001, 0.001, 0.001]}>
      {/* Glowing 768D Vector Nucleus */}
      <group ref={coreRef} position={[0, 0, 0]}>
        <mesh>
          <sphereGeometry args={[0.3, 24, 24]} />
          <meshBasicMaterial color={gold} transparent opacity={0.85} />
        </mesh>
        <pointLight color={gold} intensity={2.2} distance={2.5} />
      </group>

      {/* Swirling Neural Synaptic Constellation */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={glowTexture}
          color={emerald}
          size={isDark ? 0.095 : 0.08}
          transparent
          opacity={0.85}
          depthWrite={false}
          blending={isDark ? THREE.AdditiveBlending : THREE.NormalBlending}
        />
      </points>
    </group>
  )
}

/* =========================================================================
   STAGE 6: SCREEN (Thesis vs Archive Radar Comparison Matrix)
   ========================================================================= */
function StageNoveltyScreen({ active, isDark }) {
  const groupRef = useRef(null)
  const beamRef = useRef(null)
  const archiveGlobeRef = useRef(null)

  useFrame(({ clock }, dt) => {
    if (!groupRef.current) return
    const targetScale = active ? 1 : 0.001
    groupRef.current.scale.setScalar(THREE.MathUtils.damp(groupRef.current.scale.x, targetScale, 6, dt))
    groupRef.current.visible = groupRef.current.scale.x > 0.01

    if (active) {
      const t = clock.getElapsedTime()
      if (archiveGlobeRef.current) {
        archiveGlobeRef.current.rotation.y = t * 0.8
        archiveGlobeRef.current.rotation.x = Math.sin(t * 0.5) * 0.3
      }
      if (beamRef.current) {
        beamRef.current.material.opacity = 0.5 + Math.sin(t * 7) * 0.3
      }
    }
  })

  const emerald = isDark ? '#34d388' : '#059656'
  const magenta = isDark ? '#f472b6' : '#db2777'

  return (
    <group ref={groupRef} scale={[0.001, 0.001, 0.001]}>
      {/* Archive Knowledge Globe on the Right */}
      <group ref={archiveGlobeRef} position={[0.9, 0, 0.15]}>
        <mesh>
          <sphereGeometry args={[0.42, 16, 16]} />
          <meshBasicMaterial color={magenta} wireframe transparent opacity={0.5} />
        </mesh>
      </group>

      {/* Similarity Scanning Comparison Laser Beam */}
      <mesh ref={beamRef} position={[0.45, 0, 0.15]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.02, 0.02, 0.9, 12]} />
        <meshBasicMaterial color={emerald} transparent opacity={0.7} />
      </mesh>

      {/* Floating 85% Threshold Metric Ring */}
      <mesh position={[0.45, 0, 0.15]}>
        <torusGeometry args={[0.22, 0.015, 12, 32]} />
        <meshBasicMaterial color={magenta} transparent opacity={0.8} />
      </mesh>
    </group>
  )
}

/* =========================================================================
   STAGE 7: INDEX (pgvector Cylinder Vault Insertion & Shockwave)
   ========================================================================= */
function StageVectorIndex({ active, isDark }) {
  const groupRef = useRef(null)
  const cylinderRef = useRef(null)
  const shockwaveRef = useRef(null)

  useFrame(({ clock }, dt) => {
    if (!groupRef.current) return
    const targetScale = active ? 1 : 0.001
    groupRef.current.scale.setScalar(THREE.MathUtils.damp(groupRef.current.scale.x, targetScale, 6, dt))
    groupRef.current.visible = groupRef.current.scale.x > 0.01

    if (active) {
      const t = clock.getElapsedTime()
      if (cylinderRef.current) cylinderRef.current.rotation.y = t * 0.75
      if (shockwaveRef.current) {
        const s = ((t * 0.9) % 1) * 2.2 + 0.3
        shockwaveRef.current.scale.set(s, s, 1)
        shockwaveRef.current.material.opacity = (1 - ((t * 0.9) % 1)) * 0.75
      }
    }
  })

  const emerald = isDark ? '#10b96c' : '#046a38'
  const gold = isDark ? '#ffc72c' : '#f2a900'

  return (
    <group ref={groupRef} scale={[0.001, 0.001, 0.001]} position={[0, 0, 0.1]}>
      {/* 3D pgvector Storage Cylinder Tiers */}
      <group ref={cylinderRef}>
        {[-0.5, -0.2, 0.1, 0.4].map((y, i) => (
          <group key={i} position={[0, y, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.95, 0.02, 12, 36]} />
              <meshBasicMaterial color={i === 3 ? gold : emerald} transparent opacity={0.75} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.92, 24]} />
              <meshBasicMaterial color={emerald} transparent opacity={0.15} side={THREE.DoubleSide} />
            </mesh>
          </group>
        ))}
      </group>

      {/* Radiant Commitment Shockwave */}
      <mesh ref={shockwaveRef} position={[0, -0.5, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.9, 0.96, 48]} />
        <meshBasicMaterial color={emerald} transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>

      {/* Upward Persistence Light Pillar */}
      <pointLight position={[0, 0.5, 0]} color={emerald} intensity={2.0} distance={2.5} />
    </group>
  )
}

/* =========================================================================
   SCENE ROOT WITH POINTER PARALLAX & CAMERA
   ========================================================================= */
function IngestSceneCanvas({ progress, isDark, pointerRef, activeStageKey }) {
  const sceneGroupRef = useRef(null)

  useFrame((_, dt) => {
    if (!sceneGroupRef.current || !pointerRef?.current) return
    const targetX = pointerRef.current.y * 0.22
    const targetY = pointerRef.current.x * 0.32
    sceneGroupRef.current.rotation.x += (targetX - sceneGroupRef.current.rotation.x) * (4 * dt)
    sceneGroupRef.current.rotation.y += (targetY - sceneGroupRef.current.rotation.y) * (4 * dt)
  })

  return (
    <>
      <ambientLight intensity={isDark ? 0.8 : 0.95} />
      <directionalLight position={[3, 4, 3]} intensity={isDark ? 1.3 : 1.5} color="#c9f3db" />
      <directionalLight position={[-3, -2, -2]} intensity={0.65} color="#fde68a" />

      <group ref={sceneGroupRef}>
        {/* Core Floating Manuscript */}
        <HolographicDocument isDark={isDark} activeStageKey={activeStageKey} />

        {/* 7 Role-Based 3D Visual Effects */}
        <StageSecureSource active={activeStageKey === 'download'} isDark={isDark} />
        <StageMalwareScan active={activeStageKey === 'malware_scan'} isDark={isDark} />
        <StageExtractClean active={activeStageKey === 'extract'} isDark={isDark} />
        <StageChunking active={activeStageKey === 'chunk'} isDark={isDark} />
        <StageNeuralEmbed active={activeStageKey === 'embed'} isDark={isDark} progress={progress} />
        <StageNoveltyScreen active={activeStageKey === 'screen'} isDark={isDark} />
        <StageVectorIndex active={activeStageKey === 'index'} isDark={isDark} />
      </group>
    </>
  )
}

/**
 * High-Tech CSS 3D Fallback with Phase-Specific Holograms.
 */
function Css3DFallback({ progress, activeStageKey }) {
  const cfg = PHASE_CONFIGS[activeStageKey] ?? PHASE_CONFIGS.download

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden [perspective:800px]">
      <div
        className="absolute h-48 w-48 rounded-full blur-2xl opacity-30 animate-pulse-glow"
        style={{ backgroundColor: cfg.accent }}
      />
      <div className="absolute h-36 w-36 rounded-full bg-gold-400/20 blur-xl" />

      <div className="relative h-44 w-44 [transform-style:preserve-3d]">
        <div
          className="absolute inset-0 rounded-full border-2 border-dashed border-forest-500/40 animate-spin-slow"
          style={{ transform: 'rotateX(65deg) rotateZ(20deg)' }}
        />
        <div
          className="absolute inset-2 rounded-full border border-gold-400/50 animate-spin-slow"
          style={{ transform: 'rotateY(60deg) rotateZ(45deg)', animationDirection: 'reverse' }}
        />

        <div
          className="absolute inset-x-8 inset-y-4 rounded-xl border border-forest-400/50 bg-gradient-to-b from-forest-600/20 to-forest-900/30 p-3 shadow-xl backdrop-blur-sm"
          style={{ transform: 'rotateY(-12deg) rotateX(10deg) translateZ(10px)' }}
        >
          <div className="h-1.5 w-10 rounded mb-2" style={{ backgroundColor: cfg.accent }} />
          <div className="space-y-1.5">
            <div className="h-1 w-full rounded bg-forest-400/40" />
            <div className="h-1 w-4/5 rounded bg-forest-400/40" />
            <div className="h-1 w-full rounded bg-forest-400/40" />
          </div>
          <div className="absolute bottom-2 right-2 text-[10px] font-mono font-bold text-gold-400">
            {progress}%
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Main 3D Ingestion Scene Component.
 * Dynamically switches between the 7 distinct role-based 3D animations with smooth morphing.
 */
export default function IngestScene3D({ progress = 8, stage = 'Secure source', stageKey }) {
  const isDark = useIsDark()
  const { degraded, lost, paused, onCreated, pointerRef } = useSceneRuntime()
  const activeStageKey = normalizeStageKey(stageKey || stage)
  const cfg = PHASE_CONFIGS[activeStageKey] ?? PHASE_CONFIGS.download

  if (lost) {
    return <Css3DFallback progress={progress} activeStageKey={activeStageKey} />
  }

  return (
    <div className="relative h-64 w-full sm:h-72 lg:h-80 select-none overflow-hidden rounded-3xl bg-gradient-to-b from-forest-950/5 via-transparent to-transparent">
      {/* Dynamic phase-reactive ambient lighting aura */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          className="h-52 w-52 rounded-full blur-3xl opacity-35 transition-colors duration-700"
          style={{ backgroundColor: cfg.accent }}
        />
      </div>

      <Canvas
        aria-hidden="true"
        frameloop={paused ? 'never' : 'always'}
        dpr={degraded ? [1, 1.25] : [1, 1.75]}
        camera={{ position: [0, 0, 4.2], fov: 44 }}
        resize={{ scroll: false }}
        gl={{ alpha: true, antialias: !degraded }}
        style={{ pointerEvents: 'none', background: 'transparent' }}
        onCreated={onCreated}
      >
        <IngestSceneCanvas
          progress={progress}
          isDark={isDark}
          pointerRef={pointerRef}
          activeStageKey={activeStageKey}
        />
      </Canvas>

      {/* Cybernetic HUD Telemetry Overlay */}
      <div className="pointer-events-none absolute bottom-3 left-3.5 right-3.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-ink-muted">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-1)]/85 px-2.5 py-1 border border-[var(--border)]/70 backdrop-blur-xs shadow-xs">
          <span
            className="h-2 w-2 rounded-full animate-ping"
            style={{ backgroundColor: cfg.accent }}
          />
          <span className="uppercase tracking-wider font-semibold text-ink">{cfg.badge}</span>
        </div>

        <div className="rounded-lg bg-[var(--surface-1)]/85 px-2.5 py-1 border border-[var(--border)]/70 font-semibold text-ink-muted backdrop-blur-xs shadow-xs hidden sm:block">
          {cfg.spec}
        </div>
      </div>
    </div>
  )
}
