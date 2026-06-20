'use client'
import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { type Preset, presetRange } from './api'

export interface DateRange {
  preset: Preset
  from: number
  to: number
}

export const DateRangeContext = createContext<DateRange>({
  preset: '24h',
  ...presetRange('24h'),
})

export function useDateRange() {
  return useContext(DateRangeContext)
}

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState<DateRange>(() => ({
    preset: '7d',
    ...presetRange('7d'),
  }))

  return (
    <DateRangeContext.Provider value={range}>
      {children}
    </DateRangeContext.Provider>
  )
}
