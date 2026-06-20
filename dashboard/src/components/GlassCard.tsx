import clsx from 'clsx'

interface Props {
  children:  React.ReactNode
  className?: string
  title?:    string
  subtitle?: string
  icon?:     React.ReactNode
  action?:   React.ReactNode
  noPad?:    boolean
}

export default function GlassCard({ children, className, title, subtitle, icon, action, noPad }: Props) {
  return (
    <div className={clsx('glass rounded-2xl overflow-hidden', className)}>
      {(title || action) && (
        <div className="px-5 py-4 border-b bd flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {icon && <span className="flex-shrink-0">{icon}</span>}
            <div>
              {title    && <h3 className="text-sm font-semibold t1">{title}</h3>}
              {subtitle && <p  className="text-xs t3 mt-0.5">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="text-xs t2">{action}</div>}
        </div>
      )}
      <div className={noPad ? '' : 'p-5'}>{children}</div>
    </div>
  )
}
