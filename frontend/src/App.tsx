import { Header } from './components/layout/Header'
import { ScreeningBanner } from './components/layout/ScreeningBanner'
import { WorkspacePage } from './pages/WorkspacePage'
import { useHealth } from './hooks/useHealth'

export default function App() {
  const health = useHealth()

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-moon-950 text-moon-100">
      <Header health={health} />
      <ScreeningBanner />
      {/* Fill remaining height */}
      <div className="flex-1 overflow-hidden">
        <WorkspacePage />
      </div>
    </div>
  )
}
