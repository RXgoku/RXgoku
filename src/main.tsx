import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './tailwind.css'
import './index.css'
import StudioSite from './site/StudioSite'
import HeroPage from './App.jsx'

/**
 * The studio page is the site. The earlier hero page is kept at #/hero
 * so both designs stay reachable.
 */
function Root() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return hash.startsWith('#/hero') ? <HeroPage /> : <StudioSite />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
)
