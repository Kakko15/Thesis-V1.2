import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Compass, Home } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { PageTransition } from '../components/ui/Motion'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <PageTransition className="flex min-h-[70vh] items-center justify-center">
      <div className="text-center">
        <motion.div
          animate={{ rotate: [0, 12, -12, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          className="glass mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[1.6rem]"
        >
          <Compass size={32} className="text-gold-400" />
        </motion.div>
        <h1 className="font-display text-7xl font-extrabold tracking-tight text-gradient-isu">404</h1>
        <p className="mt-3 text-sm opacity-60">
          This page isn't in the archive — and unlike our AI, we won't make one up.
        </p>
        <Button className="mt-8" onClick={() => navigate('/')}>
          <Home size={16} /> Back to home
        </Button>
      </div>
    </PageTransition>
  )
}
