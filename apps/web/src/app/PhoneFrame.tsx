import type { ReactNode } from 'react';

/**
 * Shows the app at phone size (390 × 844) on wide screens; invisible on real phones.
 * Owner: A4. Keep the 600 px breakpoint so Playwright mobile viewports get no frame.
 * `#overlay-root` is where sheets, drawers and toasts portal to, so they stay inside the phone;
 * `#app-content` holds the screens and is made inert behind an open sheet.
 */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full w-full min-[600px]:flex min-[600px]:items-center min-[600px]:justify-center min-[600px]:py-6">
      <div
        data-testid="phone-frame"
        className="relative h-dvh w-full overflow-hidden bg-bg min-[600px]:h-[844px] min-[600px]:w-[390px] min-[600px]:rounded-[44px] min-[600px]:border min-[600px]:border-white/10 min-[600px]:shadow-[0_0_80px_rgba(111,227,255,0.08)]"
      >
        {/* made `inert` while a sheet is open (ui/Sheet) so screen readers can't wander behind it */}
        <div id="app-content" className="h-full">
          {children}
        </div>
        <div id="overlay-root" />
      </div>
    </div>
  );
}
