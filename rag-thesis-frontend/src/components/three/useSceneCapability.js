import { useEffect, useState } from 'react'

import { usePreferences } from '../../context/PreferencesContext'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { detectWebgl, evaluateSceneCapability, readBrowserSignals } from './sceneCapability'

/**
 * Live capability verdict for a decorative WebGL scene.
 *
 * The policy itself is in sceneCapability.js and is pure, so it can be tested
 * without a DOM. This hook only gathers the signals and subscribes to the ones
 * that change: viewport width, pointer coarseness, page visibility, and Data
 * Saver, which a user can toggle mid-session.
 *
 * WebGL support, device memory, and core count are read once. They cannot change
 * for the lifetime of the document, and probing WebGL repeatedly would allocate
 * a throwaway GL context on every render.
 *
 * @param {object}  options
 * @param {string}  options.wideViewportQuery Media query defining "wide enough".
 *                  Hero uses 768px (it has a full-bleed mobile treatment);
 *                  Login uses 1024px (its scene only exists beside the card).
 */
export function useSceneCapability({ wideViewportQuery = '(min-width: 768px)' } = {}) {
  const { reducedMotion, effects } = usePreferences()

  const [staticSignals] = useState(() => ({
    webgl: detectWebgl(),
    ...readBrowserSignals(),
  }))

  const wideViewport = useMediaQuery(wideViewportQuery)
  const pointerCoarse = useMediaQuery('(pointer: coarse)')

  const [pageVisible, setPageVisible] = useState(
    () => document.visibilityState !== 'hidden',
  )
  const [saveData, setSaveData] = useState(staticSignals.saveData)

  useEffect(() => {
    const onVisibilityChange = () => setPageVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  // Data Saver is toggleable while the page is open, and the Network Information
  // API reports it through a live object rather than a media query.
  useEffect(() => {
    const connection = navigator.connection || navigator.mozConnection
      || navigator.webkitConnection
    if (!connection?.addEventListener) return undefined
    const onChange = () => setSaveData(Boolean(connection.saveData))
    connection.addEventListener('change', onChange)
    return () => connection.removeEventListener('change', onChange)
  }, [])

  return evaluateSceneCapability({
    reducedMotion,
    effects,
    webgl: staticSignals.webgl,
    deviceMemory: staticSignals.deviceMemory,
    logicalCores: staticSignals.logicalCores,
    saveData,
    wideViewport,
    pointerCoarse,
    pageVisible,
  })
}
