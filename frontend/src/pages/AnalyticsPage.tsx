import { Navigate } from 'react-router-dom';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { useAdminGate } from '../lib/useAdminGate';
import { AnalyticsWorkspace } from './analytics/AnalyticsWorkspace';

/** The existing route and role gate remain the boundary for Analytics. */
export function AnalyticsPage() {
  const { status } = useAdminGate();
  if (status === 'loading') return <div style={{ minHeight: '100vh', background: 'var(--bg)' }}/>;
  if (status === 'denied') return <Navigate to="/" replace/>;
  return <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
    <Nav active="/analytics"/>
    <AnalyticsWorkspace/>
    <Footer/>
  </div>;
}
