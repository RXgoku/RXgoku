import { useEffect, useRef, useState } from 'react'
import './App.css'

/* ------------------------------------------------------------------ *
 * Content — sourced from Mitali Patkar's CV + digital marketing deck
 * ------------------------------------------------------------------ */

const EMAIL = 'patkarmitali12@gmail.com'
const PHONE = '+917859946112'
const LINKEDIN = 'https://www.linkedin.com/in/mitali-patkar-3073b2266/'

const HEADING =
  'Turning Ideas Into Digital Stories That Connect, Convert & Grow Your Brand.'
// The opening clause stays black, the rest reverses out to white.
const HEADING_DARK_PART = 'Turning Ideas Into Digital Stories'

const NAV_LINKS = [
  { label: 'About', href: '#about' },
  { label: 'Experience', href: '#experience' },
  { label: 'Brands', href: '#brands' },
  { label: 'Skills', href: '#skills' },
]

const SKILL_CHIPS = [
  'Social Media Marketing',
  'Influencer Marketing',
  'Content Planning',
  'Quora Backlinking (SEO)',
  'HubSpot',
  'Canva',
]

// Brands from the portfolio deck — rendered as text wordmarks in the ticker.
const BRANDS = [
  'Plexus Dental Studio',
  'Now & Her',
  'Darling Drinks',
  'Just By Quicklly',
  'Dharti Smile',
  'Leafbox Tea',
  'Sanghavi Smile',
  'Idiotic Media',
]

const AVATARS = [
  {
    src: 'https://polo-pecan-73837341.figma.site/_assets/v11/aa51718fb3af3637e6d666b6543fc27a175fada6.png',
    orbit: 1,
    angle: 270,
    radius: 177,
    size: 58,
    shape: 'square',
    glow: 'purple',
    delay: 0.6,
  },
  {
    src: 'https://polo-pecan-73837341.figma.site/_assets/v11/ca755f7f93c1126fb8bdbf99ab364a33aa9ab272.png',
    orbit: 2,
    angle: 60,
    radius: 251,
    size: 58,
    shape: 'round',
    glow: 'yellow',
    delay: 0.85,
  },
  {
    src: 'https://polo-pecan-73837341.figma.site/_assets/v11/dc01064c7093dcc32674876ee3cf5e41c4a485c6.png',
    orbit: 2,
    angle: 180,
    radius: 251,
    size: 78,
    shape: 'round',
    glow: 'pink',
    delay: 1.1,
  },
  {
    src: 'https://polo-pecan-73837341.figma.site/_assets/v11/d5470a58b02388336141575048720f19a50de832.png',
    orbit: 2,
    angle: 300,
    radius: 251,
    size: 58,
    shape: 'square',
    glow: 'blue',
    delay: 1.35,
  },
  {
    src: 'https://polo-pecan-73837341.figma.site/_assets/v11/018736aa5d0275c4ce56cfebaf2ae3007d81ca1e.png',
    orbit: 3,
    angle: 130,
    radius: 325,
    size: 88,
    shape: 'round',
    glow: 'pink',
    delay: 1.6,
  },
  {
    src: 'https://polo-pecan-73837341.figma.site/_assets/v11/c76d8a0b99676de31c014344bfaf75bad090758d.png',
    orbit: 4,
    angle: 30,
    radius: 399,
    size: 58,
    shape: 'round',
    glow: 'purple',
    delay: 1.85,
  },
  {
    src: 'https://polo-pecan-73837341.figma.site/_assets/v11/7b1b5f039de7b54cc9913e96c1923c3b15a157fa.png',
    orbit: 4,
    angle: 95,
    radius: 399,
    size: 88,
    shape: 'square-lg',
    glow: 'orange',
    delay: 2.0,
  },
  {
    src: 'https://polo-pecan-73837341.figma.site/_assets/v11/9ae171d8895199349755c43fbff00e122221a027.png',
    orbit: 4,
    angle: 220,
    radius: 399,
    size: 88,
    shape: 'square-lg',
    glow: 'pink',
    delay: 2.15,
  },
  {
    src: 'https://polo-pecan-73837341.figma.site/_assets/v11/926c9eb7b4bc1df846fa0e39f0b0dc3fefd80671.png',
    orbit: 4,
    angle: 320,
    radius: 399,
    size: 58,
    shape: 'round',
    glow: 'purple',
    delay: 2.3,
  },
]

/* ------------------------------------------------------------------ *
 * Hooks
 * ------------------------------------------------------------------ */

function useCountUp(target, duration = 2000, delay = 1200) {
  const [value, setValue] = useState(0)
  const frameRef = useRef(0)

  useEffect(() => {
    let startTime = null

    const step = (now) => {
      if (startTime === null) startTime = now
      const progress = Math.min((now - startTime) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // easeOutCubic
      setValue(Math.round(target * eased))
      if (progress < 1) frameRef.current = requestAnimationFrame(step)
    }

    const timeout = setTimeout(() => {
      frameRef.current = requestAnimationFrame(step)
    }, delay)

    return () => {
      clearTimeout(timeout)
      cancelAnimationFrame(frameRef.current)
    }
  }, [target, duration, delay])

  return value
}

/* ------------------------------------------------------------------ *
 * Components
 * ------------------------------------------------------------------ */

function TypewriterHeading({ text, splitIndex, speed = 35, delay = 400 }) {
  const [typedCount, setTypedCount] = useState(0)
  const [isDone, setIsDone] = useState(false)

  useEffect(() => {
    let index = 0
    let interval

    const timeout = setTimeout(() => {
      interval = setInterval(() => {
        index += 1
        setTypedCount(index)
        if (index >= text.length) {
          clearInterval(interval)
          setIsDone(true)
        }
      }, speed)
    }, delay)

    return () => {
      clearTimeout(timeout)
      clearInterval(interval)
    }
  }, [text, speed, delay])

  const typed = text.slice(0, typedCount)

  return (
    <h1 className="hero-heading">
      {/* Invisible full string reserves the final block so nothing reflows. */}
      <span className="heading-ghost" aria-hidden="true">
        {text}
      </span>
      <span className="heading-typed">
        <span className="heading-dark">{typed.slice(0, splitIndex)}</span>
        <span className="heading-light">{typed.slice(splitIndex)}</span>
        {!isDone && <span className="type-cursor" aria-hidden="true" />}
      </span>
    </h1>
  )
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PointerIcon() {
  return (
    <svg width="22" height="24" viewBox="0 0 22 24" fill="none" aria-hidden="true">
      <path
        d="M3 1.5l15.2 9.4a.9.9 0 01-.3 1.65l-6.35 1.3a.9.9 0 00-.63.47l-3.1 5.9a.9.9 0 01-1.68-.3L3 1.5z"
        fill="#A068FF"
      />
    </svg>
  )
}

function Header() {
  return (
    <header className="header">
      <div className="header-left">
        <a className="logo" href="#top">
          <span className="logo-mark" aria-hidden="true" />
          <span className="logo-text">
            Mitali <strong>Patkar</strong>
          </span>
        </a>
        <nav className="nav">
          {NAV_LINKS.map((link) => (
            <a key={link.label} className="nav-link" href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </div>

      <div className="header-right">
        <a
          className="login-link"
          href={LINKEDIN}
          target="_blank"
          rel="noreferrer noopener"
        >
          LinkedIn
        </a>
        <div className="btn-border-wrap">
          <a className="btn btn-join" href={`mailto:${EMAIL}`}>
            Hire Me
          </a>
        </div>
      </div>
    </header>
  )
}

function HeroLeft() {
  return (
    <div className="hero-left">
      <TypewriterHeading
        text={HEADING}
        splitIndex={HEADING_DARK_PART.length}
        speed={35}
        delay={400}
      />

      <p className="hero-sub" id="about">
        Social Media &amp; Digital Marketing Executive — influencer collaborations,
        content calendars and brand storytelling for brands across beauty,
        lifestyle, real estate, F&amp;B and healthcare.
      </p>

      <div className="btn-border-wrap hero-cta">
        <a className="btn btn-start" href={`mailto:${EMAIL}`}>
          Start a Project
          <ArrowIcon />
        </a>
        <a className="ghost-link" href={`tel:${PHONE}`}>
          {PHONE.replace('+91', '+91 ')}
        </a>
      </div>

      <ul className="chips" id="skills">
        {SKILL_CHIPS.map((chip) => (
          <li key={chip} className="chip">
            {chip}
          </li>
        ))}
      </ul>

      <div className="cursor-badge">
        <PointerIcon />
        <span className="cursor-label">Mitali</span>
      </div>
    </div>
  )
}

function Avatar({ avatar }) {
  const spinClass = `counter-spin-${avatar.orbit}`
  return (
    <div
      className={`avatar-slot fly-in avatar-${avatar.shape} glow-${avatar.glow}`}
      style={{
        '--angle': `${avatar.angle}deg`,
        '--radius': `${avatar.radius}px`,
        '--size': `${avatar.size}px`,
        animationDelay: `${avatar.delay}s`,
      }}
    >
      <div className={`avatar-inner ${spinClass}`}>
        <img src={avatar.src} alt="" loading="lazy" />
      </div>
    </div>
  )
}

function HeroRight() {
  const count = useCountUp(10, 2000, 1200)

  return (
    <div className="hero-right" id="experience">
      <div className="circles">
        <div className="orbit orbit-4 spin-left-60">
          {AVATARS.filter((a) => a.orbit === 4).map((a) => (
            <Avatar key={a.src} avatar={a} />
          ))}
        </div>

        <div className="orbit orbit-3 spin-right-50">
          {AVATARS.filter((a) => a.orbit === 3).map((a) => (
            <Avatar key={a.src} avatar={a} />
          ))}
        </div>

        <div className="orbit orbit-2 spin-right-40">
          {AVATARS.filter((a) => a.orbit === 2).map((a) => (
            <Avatar key={a.src} avatar={a} />
          ))}
        </div>

        <div className="orbit orbit-1 spin-left-30">
          <div className="orbit-1-content counter-spin-1">
            <span className="count-value">{count}+</span>
            <span className="count-label">Brands Grown</span>
          </div>
          {AVATARS.filter((a) => a.orbit === 1).map((a) => (
            <Avatar key={a.src} avatar={a} />
          ))}
        </div>
      </div>
    </div>
  )
}

function LogoTicker() {
  const track = [...BRANDS, ...BRANDS, ...BRANDS, ...BRANDS]

  return (
    <section className="logos" id="brands">
      <p className="logos-label">Brands I&apos;ve worked with</p>
      <div className="ticker">
        <div className="ticker-track">
          {track.map((brand, index) => (
            <span className="ticker-item" key={`${brand}-${index}`}>
              {brand}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

export default function App() {
  return (
    <div className="app" id="top">
      <Header />
      <main className="hero">
        <HeroLeft />
        <HeroRight />
      </main>
      <LogoTicker />
    </div>
  )
}
