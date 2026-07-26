import { useEffect, useRef, useState } from 'react'
import { MARQUEE_IMAGES } from '../data'

const ROW_ONE = MARQUEE_IMAGES.slice(0, 11)
const ROW_TWO = MARQUEE_IMAGES.slice(11)

function Row({ images, offset }: { images: string[]; offset: number }) {
  const tripled = [...images, ...images, ...images]

  return (
    <div className="overflow-hidden">
      <div
        className="flex gap-3"
        style={{ transform: `translateX(${offset}px)`, willChange: 'transform' }}
      >
        {tripled.map((src, index) => (
          <img
            key={`${src}-${index}`}
            src={src}
            alt=""
            loading="lazy"
            className="shrink-0 rounded-2xl object-cover"
            style={{ width: 420, height: 270 }}
          />
        ))}
      </div>
    </div>
  )
}

export default function MarqueeSection() {
  const sectionRef = useRef<HTMLElement>(null)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      const node = sectionRef.current
      if (!node) return
      setOffset((window.scrollY - node.offsetTop + window.innerHeight) * 0.3)
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const shift = offset - 200

  return (
    <section
      ref={sectionRef}
      className="bg-[#0C0C0C] pb-10 pt-24 sm:pt-32 md:pt-40"
      style={{ overflowX: 'clip' }}
    >
      <div className="flex flex-col gap-3">
        <Row images={ROW_ONE} offset={shift} />
        <Row images={ROW_TWO} offset={-shift} />
      </div>
    </section>
  )
}
