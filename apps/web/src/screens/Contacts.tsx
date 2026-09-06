import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Contact } from '../api.js';
import { initials } from '../lib.js';
import { useT, type Lang } from '../i18n.js';

export function Contacts({ lang, onPickForPayment }: { lang: Lang; onPickForPayment: (contact: Contact) => void }) {
  const t = useT(lang);
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void api.get<{ contacts: Contact[] }>('/api/contacts').then((d) => setContacts(d.contacts)).catch(() => setContacts([]));
  }, []);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/api/contacts', { displayName: name, phone });
      const data = await api.get<{ contacts: Contact[] }>('/api/contacts');
      setContacts(data.contacts);
      setName('');
      setPhone('');
      setMessage('Contact added.');
    } catch (err) {
      setMessage((err as { message?: string }).message ?? 'Could not add that contact.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <header className="topbar"><h1>{t('nav.contacts')}</h1></header>
      <div className="screen-scroll">
        <form className="card" onSubmit={add}>
          <div className="strong small">{t('nav.contacts')}</div>
          <label className="field" style={{ marginTop: 8 }}>
            <span>{t('auth.name')}</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </label>
          <label className="field">
            <span>{t('auth.phone')}</span>
            <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+26771234567" required />
          </label>
          <button className="btn secondary" type="submit" disabled={busy}>Add contact</button>
          {message && <p className="notice" style={{ marginTop: 8 }} role="status">{message}</p>}
        </form>

        {contacts === null && <div className="skeleton" style={{ height: 60 }} />}
        {(contacts ?? []).map((contact) => (
          <div key={contact.id} className="row" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <span className="avatar" style={{ background: 'linear-gradient(135deg,#0B3B8C,#00A88F)' }} aria-hidden="true">
              {initials(contact.display_name)}
            </span>
            <span style={{ flex: 1 }}>
              <span className="strong">{contact.display_name}</span>
              {contact.is_merchant === 1 && <span className="badge" style={{ marginLeft: 6 }}>Merchant</span>}
              <br />
              <span className="tiny muted">{contact.phone_e164}</span>
            </span>
            {contact.conversation_id && (
              <button className="btn secondary" style={{ width: 'auto' }} type="button"
                onClick={() => navigate(`/chat/${contact.conversation_id}`)}>Chat</button>
            )}
            <button className="btn" style={{ width: 'auto' }} type="button" onClick={() => onPickForPayment(contact)}>
              {t('home.quickPay')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
