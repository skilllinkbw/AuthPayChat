import { useCallback, useEffect, useState } from 'react';
import { HashRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, tokenStore, type Contact, type UserProfile } from './api.js';
import { Auth } from './screens/Auth.js';
import { Home } from './screens/Home.js';
import { Chat } from './screens/Chat.js';
import { Contacts } from './screens/Contacts.js';
import { Balances } from './screens/Balances.js';
import { Activity, ReceiptView } from './screens/Activity.js';
import { Settings } from './screens/Settings.js';
import { Scan } from './screens/Scan.js';
import { Merchant } from './screens/Merchant.js';
import { PaymentSheet, type ProposedPayment } from './components/PaymentSheet.js';
import { formatMoney } from './lib.js';
import { useT, type Lang } from './i18n.js';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem('paychat.lang') as Lang) ?? 'en');
  const [quickPay, setQuickPay] = useState<Contact | null>(null);

  useEffect(() => {
    void (async () => {
      if (!tokenStore.access) { setBooting(false); return; }
      try {
        const profile = await api.get<UserProfile>('/api/auth/me');
        setUser(profile);
        setLangState(profile.language === 'tn' ? 'tn' : 'en');
      } catch {
        tokenStore.clear();
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    localStorage.setItem('paychat.lang', next);
    if (user) void api.patch('/api/auth/me', { language: next }).catch(() => undefined);
  }, [user]);

  const toggleHide = useCallback(() => {
    if (!user) return;
    const next = !user.hideBalances;
    setUser({ ...user, hideBalances: next });
    void api.patch('/api/auth/me', { hideBalances: next }).catch(() => undefined);
  }, [user]);

  const refreshUser = useCallback(async () => {
    try {
      const profile = await api.get<UserProfile>('/api/auth/me');
      setUser(profile);
    } catch { /* keep the current profile */ }
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout'); } catch { /* ignore */ }
    tokenStore.clear();
    setUser(null);
  }, []);

  if (booting) {
    return (
      <div className="app">
        <div className="screen-scroll"><div className="skeleton" style={{ height: 220 }} /></div>
      </div>
    );
  }

  return (
    <HashRouter>
      <div className="app">
        {!user ? (
          <Auth lang={lang} onAuthenticated={setUser} />
        ) : (
          <Routes>
            <Route path="/" element={<Home lang={lang} hideBalances={user.hideBalances} />} />
            <Route path="/chat/:id" element={<Chat lang={lang} />} />
            <Route path="/contacts" element={
              <Contacts lang={lang} onPickForPayment={(contact) => setQuickPay(contact)} />
            } />
            <Route path="/balances" element={
              <Balances lang={lang} hideBalances={user.hideBalances} onToggleHide={toggleHide} />
            } />
            <Route path="/activity" element={<Activity lang={lang} />} />
            <Route path="/receipt/:id" element={<ReceiptView lang={lang} />} />
            <Route path="/scan" element={<Scan lang={lang} />} />
            <Route path="/merchant" element={
              <Merchant lang={lang} isMerchant={Boolean(user.isMerchant)} onOnboarded={() => void refreshUser()} />
            } />
            <Route path="/settings" element={
              <Settings lang={lang} setLang={setLang} hideBalances={user.hideBalances} onToggleHide={toggleHide} onLogout={logout} />
            } />
            <Route path="*" element={<Home lang={lang} hideBalances={user.hideBalances} />} />
          </Routes>
        )}
        {user && <BottomNav lang={lang} onPay={() => setQuickPay({ id: '', display_name: '', phone_e164: '', is_merchant: 0, conversation_id: null })} />}
        {quickPay && (
          <QuickPay lang={lang} contact={quickPay} onClose={() => setQuickPay(null)} />
        )}
      </div>
    </HashRouter>
  );
}

function BottomNav({ lang, onPay }: { lang: Lang; onPay: () => void }) {
  const t = useT(lang);
  const navigate = useNavigate();
  const location = useLocation();

  const items = [
    { path: '/', icon: '💬', label: t('nav.chats') },
    { path: '/contacts', icon: '👥', label: t('nav.contacts') },
    { path: '/pay', icon: '➤', label: t('nav.pay') },
    { path: '/scan', icon: '⛶', label: t('nav.scan') },
    { path: '/balances', icon: '💰', label: t('nav.balances') },
    { path: '/merchant', icon: '🏪', label: t('nav.merchant') },
  ];

  return (
    <nav className="bottomnav" aria-label="Main">
      {items.map((item) => (
        <button
          key={item.path}
          type="button"
          aria-current={location.pathname === item.path ? 'page' : undefined}
          onClick={() => (item.path === '/pay' ? onPay() : navigate(item.path))}
        >
          <span className="ico" aria-hidden="true">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

/** Quick pay: pick an amount, then the same confirmation sheet as in-chat payments. */
function QuickPay({ lang, contact, onClose }: { lang: Lang; contact: Contact; onClose: () => void }) {
  const t = useT(lang);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<Contact | null>(contact.id ? contact : null);
  const [amount, setAmount] = useState('');
  const [proposal, setProposal] = useState<ProposedPayment | null>(null);

  useEffect(() => {
    void api.get<{ contacts: Contact[] }>('/api/contacts').then((d) => setContacts(d.contacts)).catch(() => setContacts([]));
  }, []);

  const amountMinor = Math.round(Number(amount || 0) * 100);

  return (
    <>
      <div className="sheet-backdrop" role="dialog" aria-modal="true">
        <div className="sheet">
          <div className="grab" />
          <h2>{t('home.quickPay')}</h2>
          <label className="field">
            <span>{t('confirm.to')}</span>
            <select
              className="field"
              value={selected?.id ?? ''}
              onChange={(e) => setSelected(contacts.find((c) => c.id === e.target.value) ?? null)}
            >
              <option value="">Choose a contact…</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.display_name} · {c.phone_e164}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Amount (P)</span>
            <input className="field" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" />
          </label>
          <p className="muted small">{amountMinor > 0 ? formatMoney(amountMinor, 'BWP') : 'Enter an amount'}</p>
          <div className="btn-row">
            <button className="btn secondary" type="button" onClick={onClose}>{t('confirm.cancel')}</button>
            <button className="btn teal" type="button"
              disabled={!selected || amountMinor <= 0}
              onClick={() => setProposal({
                amountMinor,
                currency: 'BWP',
                recipientLabel: selected!.display_name,
                recipientContactId: selected!.id,
                recipientHandle: selected!.phone_e164,
                conversationId: selected!.conversation_id ?? null,
                source: 'text',
              })}>
              Continue
            </button>
          </div>
        </div>
      </div>
      {proposal && (
        <PaymentSheet lang={lang} proposal={proposal} onClose={() => { setProposal(null); onClose(); }} onDone={() => { setProposal(null); onClose(); }} />
      )}
    </>
  );
}
