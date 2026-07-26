import { useEffect } from 'react'
import HeroSection from './sections/HeroSection'
import MarqueeSection from './sections/MarqueeSection'
import AboutSection from './sections/AboutSection'
import ServicesSection from './sections/ServicesSection'
import ProjectsSection from './sections/ProjectsSection'

export default function StudioSite() {
  useEffect(() => {
    const { documentElement, body } = document
    const previous = { html: documentElement.style.background, body: body.style.background }

    documentElement.style.background = '#0C0C0C'
    body.style.background = '#0C0C0C'

    return () => {
      documentElement.style.background = previous.html
      body.style.background = previous.body
    }
  }, [])

  return (
    <div className="min-h-screen bg-[#0C0C0C] font-kanit" style={{ overflowX: 'clip' }}>
      <HeroSection />
      <MarqueeSection />
      <AboutSection />
      <ServicesSection />
      <ProjectsSection />
    </div>
  )
}
