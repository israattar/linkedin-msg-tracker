// Add a new contact: paste a LinkedIn URL, confirm the guessed name, and say
// whether the first message has been sent. The preview shows exactly what
// will be saved (and synced to Team Hub) before anything is submitted.
import { useMemo, useState } from 'react';
import type { Contact } from '../../../shared/types';
import { formatShort, todayIso } from '../../../shared/dates';
import {
  guessNameFromUrl,
  isLinkedinProfileUrl,
  normaliseLinkedinUrl,
} from '../../../shared/linkedin';
import { api } from '../lib/api';
import Avatar from '../components/Avatar';

interface Props {
  contacts: Contact[];
  refresh: () => Promise<void>;
}

interface Banner {
  kind: 'success' | 'error';
  text: string;
}

export default function AddPage({ contacts, refresh }: Props) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [website, setWebsite] = useState('');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [saving, setSaving] = useState(false);

  const urlValid = isLinkedinProfileUrl(url);

  const duplicate = useMemo(() => {
    if (!urlValid) return null;
    const key = normaliseLinkedinUrl(url);
    return contacts.find((c) => c.linkedinUrl && normaliseLinkedinUrl(c.linkedinUrl) === key) ?? null;
  }, [contacts, url, urlValid]);

  function onUrlChange(value: string): void {
    setUrl(value);
    setBanner(null);
    if (!nameEdited) setName(guessNameFromUrl(value));
  }

  async function save(firstMessageSent: boolean): Promise<void> {
    setSaving(true);
    const result = await api.addContact({
      name,
      linkedinUrl: url.trim(),
      websiteUrl: website.trim(),
      firstMessageSent,
    });
    setSaving(false);

    if (!result.ok) {
      setBanner({ kind: 'error', text: result.error });
      return;
    }

    const synced = result.contact.sync.state === 'synced';
    setBanner({
      kind: synced || !firstMessageSent ? 'success' : 'error',
      text: firstMessageSent
        ? synced
          ? `${result.contact.name} added to First msg and synced to Team Hub.`
          : `${result.contact.name} saved locally, but Team Hub sync failed. Retry from the All tab.`
        : `${result.contact.name} saved as a draft. Mark the first message sent from the All tab.`,
    });
    setUrl('');
    setName('');
    setNameEdited(false);
    setWebsite('');
    await refresh();
  }

  const canSave = urlValid && name.trim().length > 0 && !duplicate && !saving;

  return (
    <div className="page-inner">
      <h1 className="page-title">Add contact</h1>
      <p className="page-sub">Paste a LinkedIn profile URL, everything else fills itself in.</p>

      <div className="add-grid">
        <div className="add-form">
          {banner && <div className={`banner ${banner.kind}`}>{banner.text}</div>}

          <label className="field">
            <span>LinkedIn profile URL</span>
            <input
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              placeholder="https://www.linkedin.com/in/..."
              autoFocus
            />
          </label>
          {url && !urlValid && (
            <div className="banner error">That does not look like a LinkedIn profile URL.</div>
          )}
          {duplicate && (
            <div className="banner error">
              Already tracked: {duplicate.name} has this URL.
            </div>
          )}

          <label className="field">
            <span>
              Name <span className="hint">guessed from the URL, edit if wrong</span>
            </span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameEdited(true);
              }}
              placeholder="Their name"
            />
          </label>

          <label className="field">
            <span>
              Website <span className="hint">optional</span>
            </span>
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://..."
            />
          </label>

          <div className="add-submit">
            <button className="btn primary" disabled={!canSave} onClick={() => void save(true)}>
              First message sent
            </button>
            <button className="btn" disabled={!canSave} onClick={() => void save(false)}>
              Save as draft
            </button>
          </div>
        </div>

        <div>
          <div className="card preview-card">
            <Avatar name={name || '?'} size={54} />
            <div className="p-name">{name || 'Their name'}</div>
            <div className="p-link">{url || 'linkedin.com/in/...'}</div>
            <div className="p-rows">
              <div>
                <span>Stage</span>
                <span>First msg</span>
              </div>
              <div>
                <span>Date</span>
                <span>{formatShort(todayIso())}</span>
              </div>
              <div>
                <span>Website</span>
                <span>{website || 'none'}</span>
              </div>
            </div>
          </div>
          <div className="preview-note">This is exactly what saves to Team Hub.</div>
        </div>
      </div>
    </div>
  );
}
