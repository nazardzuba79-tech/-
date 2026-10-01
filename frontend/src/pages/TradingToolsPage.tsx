import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Nav } from '../components/Nav';
import { Footer } from '../components/Footer';
import { onSessionChange } from '../lib/api';
import { TradingToolsWorkspace } from './trading-tools/TradingToolsWorkspace';
import { TOOL_MODES, type ToolMode } from './trading-tools/types';
import './trading-tools/TradingToolsShell.css';

export function TradingToolsPage() {
  const [params, setParams] = useSearchParams();
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const requested = params.get('calc');
  const mode: ToolMode = TOOL_MODES.includes(requested as ToolMode) ? requested as ToolMode : 'pnl';

  // Local drafts must never survive a logout or an account change. This
  // existing notification reads no profile and starts no account request.
  useEffect(() => onSessionChange(() => setSessionEpoch(value => value + 1)), []);

  return <>
    <Nav active="/tools" hideTicker />
    <TradingToolsWorkspace key={sessionEpoch} mode={mode}
      onModeChange={next => setParams({ calc: next })} />
    <Footer />
  </>;
}
