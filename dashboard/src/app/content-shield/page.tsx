import dynamic from 'next/dynamic'

const ContentShieldClient = dynamic(
  () => import('./ContentShieldClient'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-24">
        <div className="glass rounded-2xl px-8 py-6 text-sm t3">Loading Content Shield…</div>
      </div>
    ),
  }
)

export default function ContentShieldPage() {
  return <ContentShieldClient />
}
