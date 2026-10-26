import { AppShell } from '@/components/layout/AppShell';
import { LiveUpdatesProvider } from '@/features/LiveUpdates';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <LiveUpdatesProvider>
      <AppShell>{children}</AppShell>
    </LiveUpdatesProvider>
  );
}
