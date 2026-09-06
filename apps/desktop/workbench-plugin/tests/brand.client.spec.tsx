// @vitest-environment jsdom
/**
 * Component specs for the DeepSeekGUI brand name and Workbench marker. The
 * brand mark itself is the official whale since 2026-09-06 (DeepSeekGUI is a
 * non-commercial open-source plugin set), so only the name is ours.
 * @module @see-sol-lab/deepseekgui-workbench/tests/brand
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeepSeekGUIBrandName } from '../src/client/Brand.tsx'
import { WorkbenchBadge } from '../src/client/WorkbenchBadge.tsx'

describe('DeepSeekGUI workbench brand', () => {
  it('renders the brand name', () => {
    render(<DeepSeekGUIBrandName />)
    expect(screen.getByText('DeepSeekGUI')).not.toBeNull()
  })

  it('renders the Workbench marker', () => {
    render(<WorkbenchBadge />)
    expect(screen.getByText('Workbench')).not.toBeNull()
  })

  it('matches the marker snapshot', () => {
    const { container } = render(<WorkbenchBadge />)
    expect(container.firstElementChild).toMatchSnapshot()
  })
})
