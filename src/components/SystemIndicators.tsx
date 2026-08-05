import { BrainCircuit, Database, Radio } from 'lucide-react';
import { isOllamaReady, type BackendStatusResponse } from '../../shared/protocol/index.js';

type Props = { backendOnline: boolean; status: BackendStatusResponse | null };

export function SystemIndicators({ backendOnline, status }: Props) {
  const indicators = [
    { label: 'Ollama', active: isOllamaReady(status?.ollama), icon: BrainCircuit },
    { label: 'Cartesia', active: Boolean(status?.cartesiaConfigured), icon: Radio },
    { label: 'Memória', active: Boolean(status?.databaseReady), icon: Database },
  ];
  return (
    <div className="system-indicators" aria-label="Estado dos serviços">
      {indicators.map(({ label, active, icon: Icon }) => (
        <span className={backendOnline && active ? 'service-online' : 'service-offline'} key={label}>
          <Icon size={15} /> {label}
        </span>
      ))}
    </div>
  );
}
