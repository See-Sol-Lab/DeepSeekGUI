/**
 * Account-page extension slot — the seat through which a plugin adds content
 * under the signed-in account and balance cards without editing the section.
 *
 * DeepSeekGUI (2026-09-25): its usage and balance history (spend per period
 * and the activity heatmap) sits here, so one Settings page holds the account,
 * the wallets, and the usage the resident reads together.
 *
 * TYPE HOME RATIONALE: the account section declares this slot at runtime, and
 * a plugin registering into it already depends on this package for the
 * declaration. The types therefore live with their declarer (the Models page's
 * `settings.models.footer` follows the same rule).
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Ordered extension area after the balance card of a signed-in account.
     * Without a registrant the area renders nothing.
     */
    'settings.account.footer': { kind: 'list'; scope: 'root'; owner: AccountFooterOwnerProps }
  }
}

/** Owner share of the account footer. */
export interface AccountFooterOwnerProps {
  /** Marker field: footer owner props are intentionally empty. */
  children?: never
}
