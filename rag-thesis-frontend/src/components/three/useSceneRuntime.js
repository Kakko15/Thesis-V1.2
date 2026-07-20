import { useCallback, useEffect, useRef, useState } from 'react'

/** Shared pointer, performance-degrade, and WebGL context-loss lifecycle. */
export function useSceneRuntime() {
  const pointerRef = useRef({ x: 0, y: 0 })
  const retryTimerRef = useRef(null)
  const canvasRef = useRef(null)
  const contextLossHandlerRef = useRef(null)
  const retriedRef = useRef(false)
  const [degraded, setDegraded] = useState(false)
  const [lost, setLost] = useState(false)

  useEffect(() => {
    const onMove = (event) => {
      pointerRef.current.x = (event.clientX / window.innerWidth) * 2 - 1
      pointerRef.current.y = (event.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useEffect(() => () => {
    window.clearTimeout(retryTimerRef.current)
    if (canvasRef.current && contextLossHandlerRef.current) {
      canvasRef.current.removeEventListener('webglcontextlost', contextLossHandlerRef.current)
    }
  }, [])

  const onCreated = useCallback(({ gl }) => {
    const canvas = gl.domElement
    const onContextLost = (event) => {
      event.preventDefault()
      setLost(true)
      if (!retriedRef.current) {
        retriedRef.current = true
        retryTimerRef.current = window.setTimeout(() => setLost(false), 1500)
      }
    }
    canvasRef.current = canvas
    contextLossHandlerRef.current = onContextLost
    canvas.addEventListener('webglcontextlost', onContextLost, { once: true })
  }, [])

  return { degraded, lost, onCreated, pointerRef, setDegraded }
}
