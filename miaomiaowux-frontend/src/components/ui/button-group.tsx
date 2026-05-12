import * as React from 'react'
import { cn } from '@/lib/utils'

interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Layout mode
   * - 'responsive': Right-aligned on desktop, evenly distributed auto-width on mobile
   * - 'responsive-wrap': Right-aligned on desktop, wrapping on mobile
   * - 'always-full': Always evenly distributed full width
   * - 'always-auto': Always auto width
   * - 'adaptive-full': Auto equal-width grid based on button count
   */
  mode?:
    | 'responsive'
    | 'responsive-wrap'
    | 'always-full'
    | 'always-auto'
    | 'adaptive-full'
  /**
   * Button gap
   */
  gap?: 'sm' | 'md' | 'lg'
  /**
   * Fixed column count, only applies in adaptive-full mode
   */
  columns?: number
  /**
   * Max column count, only applies in adaptive-full mode
   */
  maxColumns?: number
  /**
   * Hide button icons on mobile
   */
  hideIconOnMobile?: boolean
}

/**
 * ButtonGroup component - unified button layout management
 *
 * Usage:
 * ```tsx
 * <ButtonGroup mode="responsive" hideIconOnMobile>
 *   <Button variant="outline"><MapPin />Region Group</Button>
 *   <Button variant="outline"><Layers />Manual Group</Button>
 *   <Button><Save />Save Subscription</Button>
 * </ButtonGroup>
 * ```
 */
const ButtonGroup = React.forwardRef<HTMLDivElement, ButtonGroupProps>(
  (
    {
      className,
      mode = 'responsive',
      gap = 'md',
      columns,
      maxColumns,
      hideIconOnMobile = false,
      children,
      style,
      ...props
    },
    ref
  ) => {
    const gapClass = {
      sm: 'gap-1.5',
      md: 'gap-2',
      lg: 'gap-3',
    }[gap]

    const modeClass = {
      // Right-aligned on desktop, evenly distributed on mobile
      responsive: 'flex justify-end [&>*]:flex-1 sm:[&>*]:flex-none',
      // Right-aligned on desktop, wrapping on mobile
      'responsive-wrap': 'flex flex-wrap justify-end',
      // Always evenly distributed
      'always-full': 'flex [&>*]:flex-1',
      // Always auto width, right-aligned
      'always-auto': 'flex justify-end',
      // Auto equal-width grid based on button count
      'adaptive-full': 'grid w-full [&>*]:w-full [&>*]:min-w-0',
    }[mode]

    const visibleChildCount =
      React.Children.toArray(children).filter(Boolean).length
    const computedColumns = (() => {
      if (mode !== 'adaptive-full') return undefined
      const base = columns ?? visibleChildCount
      const safeBase = Math.max(1, base)
      if (!maxColumns || maxColumns <= 0) return safeBase
      return Math.min(safeBase, maxColumns)
    })()

    // Hide icons on mobile
    const hideIconClass = hideIconOnMobile
      ? '[&_svg]:hidden sm:[&_svg]:inline [&_button]:gap-0 sm:[&_button]:gap-2'
      : ''

    return (
      <div
        ref={ref}
        className={cn(modeClass, gapClass, hideIconClass, className)}
        style={
          mode === 'adaptive-full' && computedColumns
            ? {
                ...style,
                gridTemplateColumns: `repeat(${computedColumns}, minmax(0, 1fr))`,
              }
            : style
        }
        {...props}
      >
        {children}
      </div>
    )
  }
)
ButtonGroup.displayName = 'ButtonGroup'

export { ButtonGroup }
