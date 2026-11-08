import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { IconButton } from './IconButton';

/**
 * Top bar for secondary screens: back to Home, a title (h1) and optional actions. Arriving with
 * `state.focusHeading` (e.g. from the sidebar) moves focus to the title, so keyboard and screen
 * reader users start on the new screen rather than on the page body.
 */
export function ScreenHeader({
  title,
  actions,
  backTo = '/',
}: {
  title: ReactNode;
  actions?: ReactNode;
  backTo?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = Boolean((location.state as { focusHeading?: boolean } | null)?.focusHeading);
  useEffect(() => {
    if (focusHeading) heading.current?.focus();
  }, [focusHeading, location.key]);
  return (
    <header className="flex items-center gap-1 px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2">
      <IconButton label="Back" onClick={() => navigate(backTo)}>
        <ArrowLeft aria-hidden size={22} />
      </IconButton>
      <h1 ref={heading} tabIndex={-1} className="min-w-0 flex-1 truncate text-lg font-semibold">
        {title}
      </h1>
      {actions}
    </header>
  );
}
