import type { ReactNode } from 'react';

export default function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="glyph" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}
