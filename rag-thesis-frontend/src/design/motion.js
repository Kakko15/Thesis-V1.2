export const motionTokens = Object.freeze({
  duration: Object.freeze({ instant: 0.1, short: 0.2, medium: 0.4, long: 0.7 }),
  easing: Object.freeze({
    standard: [0.2, 0, 0, 1],
    emphasized: [0.2, 0, 0, 1],
    exit: [0.4, 0, 1, 1],
  }),
  spring: Object.freeze({ type: 'spring', stiffness: 320, damping: 28, mass: 0.8 }),
  stagger: Object.freeze({ compact: 0.04, expressive: 0.08 }),
})
