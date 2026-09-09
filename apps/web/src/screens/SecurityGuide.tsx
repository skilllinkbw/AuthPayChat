import { useT, type Lang } from '../i18n.js';

export function SecurityGuide({ lang }: { lang: Lang }) {
  const t = useT(lang);
  void t;
  return (
    <div className="screen">
      <div className="legal-screen">
        <div className="back-bar"><a href="#/">Back to PayChat</a></div>
        <img src="/paychat-logo.png" alt="PayChat" style={{ width: 120, display: 'block', margin: '0 auto' }} />
        <h1 style={{ textAlign: 'center' }}>Safe Payment Guidance</h1>
        <p className="legal-meta" style={{ textAlign: 'center' }}>
          PayChat - a product of Braincade Holdings (Pty) Ltd
        </p>

        <div className="notice" style={{ background: 'rgba(198,40,40,0.08)', borderColor: 'rgba(198,40,40,0.25)' }}>
          <strong>Protect yourself and your money.</strong> Please read this guidance carefully.
        </div>

        <h2>Keep Your Credentials Secret</h2>
        <ul>
          <li><strong>Never share your PIN</strong> with anyone - not even people claiming to be from your bank or from PayChat.</li>
          <li><strong>Never share your password</strong> with anyone.</li>
          <li><strong>Never share OTPs (one-time pins)</strong> or authentication codes with anyone.</li>
          <li><strong>Never disclose confidential banking credentials</strong> to anyone who contacts you.</li>
          <li>PayChat and legitimate banks will <em>never</em> ask for your password or PIN by phone, message, or email.</li>
        </ul>

        <h2>Before You Pay</h2>
        <ul>
          <li><strong>Verify the recipient</strong> before confirming a payment - check the name and number carefully.</li>
          <li><strong>Verify the amount</strong> before authorising - check it twice.</li>
          <li>Be especially careful with large payments or payments to new recipients.</li>
          <li>If something feels wrong, stop and check.</li>
        </ul>

        <h2>Protect Your Device</h2>
        <ul>
          <li><strong>Protect your phone</strong> with a secure device lock (PIN, password, fingerprint, or face).</li>
          <li><strong>Keep the operating system updated</strong> - updates fix security issues.</li>
          <li><strong>Keep PayChat updated</strong> - install updates when they are available.</li>
          <li><strong>Only install PayChat from official, trusted sources.</strong></li>
        </ul>

        <h2>App Usage Safety</h2>
        <ul>
          <li><strong>Do not let other people use an authenticated PayChat session</strong> on your device.</li>
          <li>Always log out or lock your device when you are not using it.</li>
          <li>Enable biometric confirmation in Settings for stronger protection.</li>
        </ul>

        <h2>If Something Goes Wrong</h2>
        <ul>
          <li><strong>Report suspected fraud immediately.</strong></li>
          <li><strong>Report unauthorised transactions immediately.</strong></li>
          <li><strong>Report a lost or stolen device promptly</strong> so your accounts can be protected.</li>
          <li><strong>Review your payment notifications and receipts</strong> regularly.</li>
          <li><strong>Use only official support channels</strong> listed in this app.</li>
        </ul>

        <h2>Official Support</h2>
        <p>Braincade Holdings (Pty) Ltd<br />
        Phone: +267 76 749 821 / +267 26 150 87</p>

        <p className="legal-meta" style={{ marginTop: 16 }}><em>If you believe your account has been compromised, contact us immediately through the official numbers above.</em></p>
      </div>
    </div>
  );
}
