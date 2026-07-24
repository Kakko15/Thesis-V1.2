import { useCallback, useEffect, useRef, useState } from 'react'

/** Shared pointer, performance-degrade, and WebGL context-loss lifecycle. */
export function useSceneRuntime() {
  const pointerRef = useRef({ x: 0, y: 0 })
  const retryTimerRef = useRef(null)
  const canvasRef = useRef(null)
  const contextLossHandlerRef = useRef(null)
  const contextRestoreHandlerRef = useRef(null)
  const rendererRef = useRef(null)
  const retriedRef = useRef(false)
  const [degraded, setDegraded] = useState(false)
  const [lost, setLost] = useState(false)
  const [paused, setPaused] = useState(() => document.hidden)

  useEffect(() => {
    const onMove = (event) => {
      pointerRef.current.x = (event.clientX / window.innerWidth) * 2 - 1
      pointerRef.current.y = (event.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    if (paused || degraded || lost) return undefined
    let frame = 0
    let lowWindows = 0
    let started = performance.now()
    let requestId
    const sample = (now) => {
      frame += 1
      const elapsed = now - started
      if (elapsed >= 1000) {
        const fps = frame * 1000 / elapsed
        lowWindows = fps < 45 ? lowWindows + 1 : 0
        if (lowWindows >= 3) {
          setDegraded(true)
          return
        }
        frame = 0
        started = now
      }
      requestId = window.requestAnimationFrame(sample)
    }
    requestId = window.requestAnimationFrame(sample)
    return () => window.cancelAnimationFrame(requestId)
  }, [degraded, lost, paused])

  useEffect(() => () => {
    window.clearTimeout(retryTimerRef.current)
    if (canvasRef.current && contextLossHandlerRef.current) {
      canvasRef.current.removeEventListener('webglcontextlost', contextLossHandlerRef.current)
      canvasRef.current.removeEventListener('webglcontextrestored', contextRestoreHandlerRef.current)
    }
    rendererRef.current?.dispose?.()
  }, [])

  const onCreated = useCallback(({ gl }) => {
    const canvas = gl.domElement
    const onContextLost = (event) => {
      event.preventDefault()
      setLost(true)
      if (retriedRef.current) {
        gl.dispose()
      } else {
        retriedRef.current = true
        retryTimerRef.current = window.setTimeout(() => setDegraded(true), 1500)
      }
    }
    const onContextRestored = () => {
      window.clearTimeout(retryTimerRef.current)
      setDegraded(true)
      setLost(false)
    }
    canvasRef.current = canvas
    rendererRef.current = gl
    contextLossHandlerRef.current = onContextLost
    contextRestoreHandlerRef.current = onContextRestored
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)
  }, [])

  return { degraded, lost, paused, onCreated, pointerRef, setDegraded }
}
