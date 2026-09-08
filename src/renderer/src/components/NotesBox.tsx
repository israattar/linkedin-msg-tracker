// Free-form personal notes, always visible and editable, on every contact
// row. Local only, auto-saves shortly after typing stops - separate from
// importedNotes, which is the read-only Team Hub card description.
import { useEffect, useRef, useState } from 'react';
import type { Contact } from '../../../shared/types';
import { api } from '../lib/api';

export default function NotesBox({ contact }: { contact: Contact }) {
  const [text, setText] = useState(contact.notes);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setText(contact.notes);
    setState('idle');
  }, [contact.id]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function onChange(value: string): void {
    setText(value);
    setState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void api.saveNotes(contact.id, value).then(() => setState('saved'));
    }, 500);
  }

  return (
    <div className="my-notes" onClick={(e) => e.stopPropagation()}>
      <div className="my-notes-label">
        Notes
        <span className="faint-text">
          {state === 'saving' && 'Saving...'}
          {state === 'saved' && 'Saved'}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Anything worth remembering about this contact..."
        rows={2}
      />
    </div>
  );
}
