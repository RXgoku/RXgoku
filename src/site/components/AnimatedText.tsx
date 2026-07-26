import { useRef } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'
import type { MotionValue } from 'framer-motion'

interface AnimatedTextProps {
  text: string
  className?: string
  style?: React.CSSProperties
}

function Char({
  char,
  progress,
  range,
}: {
  char: string
  progress: MotionValue<number>
  range: [number, number]
}) {
  const opacity = useTransform(progress, range, [0.2, 1])

  return (
    <span className="relative inline-block">
      {/* Invisible copy holds the layout; the animated copy sits on top. */}
      <span className="opacity-0">{char}</span>
      <motion.span className="absolute left-0 top-0" style={{ opacity }}>
        {char}
      </motion.span>
    </span>
  )
}

/** Reveals the paragraph character by character as it scrolls through view. */
export default function AnimatedText({ text, className, style }: AnimatedTextProps) {
  const ref = useRef<HTMLParagraphElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.8', 'end 0.2'],
  })

  const words = text.split(' ')
  const total = text.length
  let cursor = 0

  return (
    <p ref={ref} className={className} style={style}>
      {words.map((word, wordIndex) => {
        const chars = word.split('')
        const node = (
          <span className="inline-block whitespace-nowrap" key={`${word}-${wordIndex}`}>
            {chars.map((char, charIndex) => {
              const start = cursor / total
              const end = (cursor + 1) / total
              cursor += 1
              return (
                <Char
                  key={`${char}-${charIndex}`}
                  char={char}
                  progress={scrollYProgress}
                  range={[start, end]}
                />
              )
            })}
          </span>
        )
        cursor += 1 // the space that follows the word
        return (
          <span key={`w-${wordIndex}`}>
            {node}
            {wordIndex < words.length - 1 ? ' ' : null}
          </span>
        )
      })}
    </p>
  )
}
