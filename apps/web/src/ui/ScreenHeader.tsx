import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { IconButton } from './IconButton';

/** Top bar for secondary screens: back to Home, a title (h1) and optional actions. */
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
  return (
    <header className="flex items-center gap-1 px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2">
      <IconButton label="Back" onClick={() => navigate(backTo)}>
        <ArrowLeft aria-hidden size={22} />
      </IconButton>
      <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
      {actions}
    </header>
  );
}
