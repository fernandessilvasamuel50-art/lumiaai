import { Activity, Wifi, WifiOff } from 'lucide-react';
import type { VoiceStatus } from '../shared/protocol.js';

type StatusPillProps = {
  status: VoiceStatus;
  backendOnline: boolean;
  socketActive: boolean;
};

export function StatusPill({ status, backendOnline, socketActive }: StatusPillProps) {
  const ConnectionIcon = backendOnline ? Wifi : WifiOff;

  return (
    <div className="status-cluster" aria-live="polite">
      <span className={`connection-pill ${backendOnline ? 'online' : 'offline'}`}>
        <ConnectionIcon size={16} aria-hidden="true" />
        {backendOnline ? 'Backend online' : 'Backend offline'}
      </span>
      <span className={`voice-status ${socketActive ? 'active' : ''}`}>
        <Activity size={16} aria-hidden="true" />
        {status}
      </span>
    </div>
  );
}

