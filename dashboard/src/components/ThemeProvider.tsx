'use client'
import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'dark' | 'light'
export type FontSize = 'sm' | 'md' | 'lg'

const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} })
const FontSizeCtx = createContext<{ fontSize: FontSize; setFontSize: (s: FontSize) => void }>({ fontSize: 'md', setFontSize: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark')
  const [fontSize, setFontSizeState] = useState<FontSize>('md')

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as Theme | null
    const initialTheme = savedTheme ?? 'dark'
    setTheme(initialTheme)
    document.documentElement.setAttribute('data-theme', initialTheme)

    const savedSize = localStorage.getItem('gw-font-size') as FontSize | null
    const initialSize = savedSize ?? 'md'
    setFontSizeState(initialSize)
    document.documentElement.setAttribute('data-font-size', initialSize)
  }, [])

  const toggle = () => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('theme', next)
      document.documentElement.setAttribute('data-theme', next)
      return next
    })
  }

  const setFontSize = (s: FontSize) => {
    setFontSizeState(s)
    localStorage.setItem('gw-font-size', s)
    document.documentElement.setAttribute('data-font-size', s)
  }

  return (
    <ThemeCtx.Provider value={{ theme, toggle }}>
      <FontSizeCtx.Provider value={{ fontSize, setFontSize }}>
        {children}
      </FontSizeCtx.Provider>
    </ThemeCtx.Provider>
  )
}

export const useTheme = () => useContext(ThemeCtx)
export const useFontSize = () => useContext(FontSizeCtx)
