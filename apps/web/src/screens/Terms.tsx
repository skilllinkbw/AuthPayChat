import { useT, type Lang } from '../i18n.js';

const EFFECTIVE_DATE = 'September 2026';

export function Terms({ lang }: { lang: Lang }) {
  const t = useT(lang);
  void t;
  return (
    <div className="screen">
      <div className="legal-screen">
        <div className="back-bar"><a href="#/">Back to PayChat</a></div>
        <img src="/paychat-logo.png" alt="PayChat" style={{ width: 120, display: 'block', margin: '0 auto' }} />
        <h1 style={{ textAlign: 'center' }}>Terms and Conditions</h1>
        <p className="legal-meta" style={{ textAlign: 'center' }}>
          PayChat - a product of Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
        </p>
        <p className="legal-meta" style={{ textAlign: 'center' }}>Effective: {EFFECTIVE_DATE}</p>

        <h2>1. Service Description</h2>
        <p>PayChat is a conversational payment application developed by Braincade Holdings (Pty) Ltd ("we", "us", "our"). It enables users to send and receive money, view balances, and manage payment accounts through a chat-based interface. Payment services are delivered through PayChat's secure payment infrastructure and supported third-party payment providers.</p>

        <h2>2. User Responsibilities</h2>
        <ul>
          <li>You are responsible for maintaining the confidentiality of your account credentials, including your password and any PINs.</li>
          <li>You must provide accurate and truthful information when registering and using the service.</li>
          <li>You are responsible for all activity that occurs under your account.</li>
          <li>You must be at least 18 years old to use this service.</li>
        </ul>

        <h2>3. Account Security</h2>
        <ul>
          <li>Never share your password, PIN, OTP, or authentication codes with anyone.</li>
          <li>Enable biometric confirmation where available for stronger protection.</li>
          <li>Report suspected unauthorised access to your account immediately.</li>
          <li>Protect your device with a secure lock screen.</li>
        </ul>

        <h2>4. Payments</h2>
        <ul>
          <li>All payments require explicit confirmation by you before they are submitted.</li>
          <li>Verify the recipient and amount before confirming any payment.</li>
          <li>Once a payment is submitted to a live provider, it may not be reversible depending on the provider policies.</li>
          <li>We are not liable for payments sent to an incorrect recipient due to your error.</li>
        </ul>

        <h2>5. Transaction Authorisation</h2>
        <p>Payments above certain thresholds require additional verification (step-up authentication). You authorise us to process transactions you confirm through the app. We may decline or delay transactions for security or compliance reasons.</p>

        <h2>6. Errors, Fraud, and Unauthorised Transactions</h2>
        <ul>
          <li>Report suspected fraud, unauthorised transactions, or errors immediately.</li>
          <li>We will investigate reported issues in accordance with applicable procedures.</li>
          <li>We are not responsible for losses resulting from you sharing your credentials.</li>
        </ul>

        <h2>7. Disputes</h2>
        <p>Contact us to raise a dispute. We will handle disputes in accordance with our policies and applicable law. This document does not replace any rights you may have under consumer protection legislation.</p>

        <h2>8. Availability</h2>
        <p>The service is provided "as is". We aim for high availability but do not guarantee uninterrupted access. Maintenance, provider outages, or network issues may affect availability.</p>

        <h2>9. Third-Party Providers</h2>
        <p>PayChat integrates third-party payment providers (mobile money, banks, card processors). Your use of those services is also subject to the provider own terms. We are not responsible for the acts or omissions of third-party providers.</p>

        <h2>10. Sandbox / Demo Limitations</h2>
        <p>When operating in sandbox or demonstration mode, no real money is moved. Transactions shown are simulated. Sandbox mode is clearly identified within the application. No reliance should be placed on sandbox data for financial decisions.</p>

        <h2>11. Privacy and Data Handling</h2>
        <p>We process personal data as described in our Privacy Notice. By using PayChat, you agree to the processing described there.</p>

        <h2>12. Service Limitations and Changes</h2>
        <p>We may update, suspend, or discontinue features. Material changes to these terms will be communicated through the app.</p>

        <h2>13. Termination</h2>
        <p>We may suspend or terminate access if you breach these terms or use the service fraudulently. You may stop using the service at any time.</p>

        <h2>14. Contact / Support</h2>
        <p>Braincade Holdings (Pty) Ltd<br />
        Reg. No. BW00001951757<br />
        Phone: +267 76 749 821 / +267 26 150 87</p>

        <p className="legal-meta" style={{ marginTop: 16 }}><em>These terms are provided for the demonstration version of PayChat. A full legal review is recommended before commercial deployment.</em></p>
      </div>
    </div>
  );
}
