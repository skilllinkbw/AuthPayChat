import { useT, type Lang } from '../i18n.js';

const EFFECTIVE_DATE = 'September 2026';

export function Privacy({ lang }: { lang: Lang }) {
  const t = useT(lang);
  void t;
  return (
    <div className="screen">
      <div className="legal-screen">
        <div className="back-bar"><a href="#/">Back to PayChat</a></div>
        <img src="/paychat-logo.png" alt="PayChat" style={{ width: 120, display: 'block', margin: '0 auto' }} />
        <h1 style={{ textAlign: 'center' }}>Privacy Notice</h1>
        <p className="legal-meta" style={{ textAlign: 'center' }}>
          PayChat - a product of Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
        </p>
        <p className="legal-meta" style={{ textAlign: 'center' }}>Effective: {EFFECTIVE_DATE}</p>

        <h2>1. What Information We Process</h2>
        <ul>
          <li><strong>Registration information:</strong> phone number, display name, language preference.</li>
          <li><strong>Authentication information:</strong> password hashes, session tokens, biometric credentials (stored on your device, not by us).</li>
          <li><strong>Transaction information:</strong> payment amounts, recipients, timestamps, references, status, provider used.</li>
          <li><strong>Account information:</strong> connected payment accounts, balances, transaction history.</li>
          <li><strong>Device information:</strong> device label, platform, session identifiers for security.</li>
          <li><strong>Communications:</strong> chat messages sent through the app (used to detect payment commands).</li>
        </ul>

        <h2>2. Why We Process Information</h2>
        <ul>
          <li>To provide and secure the PayChat service.</li>
          <li>To process and record payments you authorise.</li>
          <li>To authenticate you and protect your account.</li>
          <li>To comply with legal and regulatory obligations.</li>
          <li>To communicate service and security notifications.</li>
        </ul>

        <h2>3. Authentication and Security</h2>
        <p>Passwords are hashed (scrypt). We never store your fingerprint or face - biometric verification is performed by your device. Access tokens are short-lived; refresh tokens are hashed at rest.</p>

        <h2>4. Third-Party Providers</h2>
        <p>To process payments, we share necessary transaction information with the selected payment provider (e.g., mobile money operator, bank, card processor). Those providers process data under their own privacy policies.</p>

        <h2>5. Data Retention</h2>
        <p>We retain information as long as your account is active and as required for legal, regulatory, and audit purposes. You may request deletion of your account data, subject to legal retention requirements.</p>

        <h2>6. Data Security</h2>
        <p>We use encryption in transit, encrypted storage for provider tokens at rest, access controls, and audit logging. No system is completely secure; we apply industry-standard safeguards.</p>

        <h2>7. Your Rights</h2>
        <p>Depending on applicable law, you may have rights to access, correct, delete, or object to processing of your personal data. Contact us to exercise these rights.</p>

        <h2>8. Regulatory / Legal Requirements</h2>
        <p>PayChat is designed with Botswana regulatory requirements in mind, including anti-money laundering, consumer protection, and data protection considerations. Specific compliance obligations may apply as the service scales.</p>

        <h2>9. Contact</h2>
        <p>Braincade Holdings (Pty) Ltd<br />
        Reg. No. BW00001951757<br />
        Phone: +267 76 749 821 / +267 26 150 87</p>

        <p className="legal-meta" style={{ marginTop: 16 }}><em>This Privacy Notice is provided for the demonstration version of PayChat. A formal data-protection legal review is recommended before commercial deployment.</em></p>
      </div>
    </div>
  );
}
