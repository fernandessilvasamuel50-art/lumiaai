import type { CSSProperties } from 'react';

type ReactiveWaveProps = {
  active: boolean;
  level: number;
};

export function ReactiveWave({ active, level }: ReactiveWaveProps) {
  return (
    <div className={`wave ${active ? 'active' : ''}`} aria-hidden="true" style={{ '--level': level } as CSSProperties}>
      {Array.from({ length: 18 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}
