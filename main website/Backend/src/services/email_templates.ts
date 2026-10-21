/**
 * Responsive HTML & Plain-Text Email Templates for ZdexCloud Platform
 * STRICT RULE: No verification links. No password reset links. OTP only.
 */

export interface EmailTemplatePayload {
  subject: string;
  html: string;
  text: string;
}

/**
 * Generates the Registration Email Verification OTP template
 */
export function getEmailVerificationTemplate(otpCode: string, expiryMinutes: number = 10): EmailTemplatePayload {
  const subject = '[ZdexCloud] Verify Your Email Address';

  const text = `
ZdexCloud Personal File Server
===============================

Your 6-digit email verification code is:

${otpCode}

This code will expire in ${expiryMinutes} minutes.

Enter this code on the ZdexCloud verification screen to complete your registration.

Security Notice:
If you did not create an account with ZdexCloud, please disregard this message. Do not share this code with anyone.

--
ZdexCloud Personal File Server Team
https://zdexcloud.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email — ZdexCloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <!-- Header -->
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">ZdexCloud</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <!-- Body Content -->
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; text-align: center;">Verify Your Email Address</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; text-align: center;">
          Thank you for registering with ZdexCloud. Please enter the 6-digit verification code below on your setup screen to activate your account:
        </p>
        
        <!-- OTP Code Box -->
        <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px;">
          <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #0284c7; display: block; margin-left: 8px;">${otpCode}</span>
          <span style="font-size: 12px; font-weight: 600; color: #0369a1; text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; margin-top: 8px;">Valid for ${expiryMinutes} minutes</span>
        </div>

        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin: 0 0 12px;">
          <strong>Security Note:</strong> ZdexCloud will never ask for your verification code via phone, chat, or external message. Do not share this code.
        </p>
        <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0;">
          If you did not request this registration, you can safely ignore this email.
        </p>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 ZdexCloud Platform &bull; Testing & Staging Environment
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

/**
 * Generates the Password Reset OTP template
 */
export function getPasswordResetTemplate(otpCode: string, expiryMinutes: number = 10): EmailTemplatePayload {
  const subject = '[ZdexCloud] Reset Your Password';

  const text = `
ZdexCloud Personal File Server
===============================

A password reset was requested for your ZdexCloud account.

Your 6-digit password reset code is:

${otpCode}

This code will expire in ${expiryMinutes} minutes.

Enter this code on the password reset screen along with your new password.

Security Warning:
If you did not request a password reset, someone may be attempting to access your account. Please ensure your email is secure. Do not share this code with anyone.

--
ZdexCloud Personal File Server Team
https://zdexcloud.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password — ZdexCloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <!-- Header -->
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">ZdexCloud</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <!-- Body Content -->
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; text-align: center;">Reset Your Account Password</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; text-align: center;">
          We received a request to reset the password for your ZdexCloud account. Use the 6-digit code below to set a new password:
        </p>
        
        <!-- OTP Code Box -->
        <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px;">
          <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #dc2626; display: block; margin-left: 8px;">${otpCode}</span>
          <span style="font-size: 12px; font-weight: 600; color: #b91c1c; text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; margin-top: 8px;">Valid for ${expiryMinutes} minutes</span>
        </div>

        <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 12px 16px; margin: 0 0 20px;">
          <p style="font-size: 12px; line-height: 1.5; color: #92400e; margin: 0;">
            <strong>⚠️ Security Warning:</strong> If you did not make this request, someone may be trying to access your account. Your current password remains active until this code is submitted.
          </p>
        </div>

        <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0;">
          ZdexCloud will never ask for this code. Do not share it with anyone.
        </p>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 ZdexCloud Platform &bull; Testing & Staging Environment
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

/**
 * Generates the Authenticated Password Change OTP template
 */
export function getPasswordChangeOtpTemplate(otpCode: string, expiryMinutes: number = 10): EmailTemplatePayload {
  const subject = '[ZdexCloud] Confirm Your Password Change';

  const text = `
ZdexCloud Personal File Server
===============================

An authenticated request was made from your Account Settings to change your ZdexCloud account password.

Your 6-digit password change verification code is:

${otpCode}

This code will expire in ${expiryMinutes} minutes.

Enter this code in your ZdexCloud Account Settings to confirm your new password. Once confirmed, all active web sessions and linked device tokens will be signed out for your protection.

Security Warning:
If you did not initiate this password change from your account settings, someone may have active access to your session. Do not share this code with anyone.

--
ZdexCloud Personal File Server Team
https://zdexcloud.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirm Password Change — ZdexCloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <!-- Header -->
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">ZdexCloud</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <!-- Body Content -->
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; text-align: center;">Confirm Your Password Change</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; text-align: center;">
          You requested to change your ZdexCloud account password from Account Settings. Enter the 6-digit verification code below to confirm this change:
        </p>
        
        <!-- OTP Code Box -->
        <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px;">
          <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #0284c7; display: block; margin-left: 8px;">${otpCode}</span>
          <span style="font-size: 12px; font-weight: 600; color: #0369a1; text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; margin-top: 8px;">Valid for ${expiryMinutes} minutes</span>
        </div>

        <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 12px 16px; margin: 0 0 20px;">
          <p style="font-size: 12px; line-height: 1.5; color: #92400e; margin: 0;">
            <strong>Security Notice:</strong> Confirming this code will update your password and immediately sign out all active web sessions and linked device tokens. If you did not initiate this request, do not enter or share this code.
          </p>
        </div>

        <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0;">
          ZdexCloud will never ask for this verification code.
        </p>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 ZdexCloud Platform &bull; Testing & Staging Environment
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

/**
 * Generates the Login 2FA OTP template
 */
export function getLoginOtpTemplate(otpCode: string, expiryMinutes: number = 10): EmailTemplatePayload {
  const subject = '[ZdexCloud] Your Login Security Code';

  const text = `
ZdexCloud Personal File Server
===============================

Your 6-digit login verification code is:

${otpCode}

This code will expire in ${expiryMinutes} minutes.

Enter this code on the ZdexCloud login screen to access your account.

Security Notice:
If you did not attempt to sign in to ZdexCloud, please change your password immediately.

--
ZdexCloud Personal File Server Team
https://zdexcloud.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Security Code — ZdexCloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <!-- Header -->
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">ZdexCloud</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <!-- Body Content -->
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; text-align: center;">Sign-In Security Code</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; text-align: center;">
          A login attempt requires two-factor email verification. Please enter the 6-digit code below:
        </p>
        
        <!-- OTP Code Box -->
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px;">
          <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #16a34a; display: block; margin-left: 8px;">${otpCode}</span>
          <span style="font-size: 12px; font-weight: 600; color: #15803d; text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; margin-top: 8px;">Valid for ${expiryMinutes} minutes</span>
        </div>

        <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0;">
          If you did not attempt to sign in, please secure your account immediately.
        </p>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 ZdexCloud Platform &bull; Testing & Staging Environment
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

export interface InvoiceEmailTemplateParams {
  invoiceNumber: string;
  issuedAt: Date | string;
  totalMinorUnits: number;
  currency: string;
  customerName?: string | null;
  portalUrl?: string;
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAsciiCurrency(amountMinorUnits: number, currency: string): string {
  const code = (currency || 'INR').toUpperCase();
  const major = (amountMinorUnits / 100).toFixed(2);
  return `${code} ${major}`;
}

function formatTemplateDate(date: Date | string | null | undefined): string {
  if (!date) return 'N/A';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return 'N/A';
  const day = String(d.getUTCDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Generates the Invoice Issued notification email template (HTML and plain text).
 * Security invariants:
 * - Does NOT attach PDF.
 * - Links to authenticated ZdexCloud billing portal.
 * - Pure ASCII currency representation.
 * - Strict HTML escaping of all dynamic values.
 * - Omits internal DB IDs, Razorpay IDs, and customer tax IDs.
 */
export function getInvoiceIssuedEmailTemplate(params: InvoiceEmailTemplateParams): EmailTemplatePayload {
  const safeInvoiceNumber = escapeHtml(params.invoiceNumber || 'N/A');
  const plainInvoiceNumber = params.invoiceNumber || 'N/A';
  const dateStr = formatTemplateDate(params.issuedAt);
  const formattedAmount = formatAsciiCurrency(params.totalMinorUnits, params.currency);
  const portalUrl = (params.portalUrl || 'https://zdexcloud.com/billing').trim();
  const safePortalUrl = escapeHtml(portalUrl);
  const customerGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${escapeHtml(params.customerName.trim())},`
    : 'Hello,';
  const textGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${params.customerName.trim()},`
    : 'Hello,';

  const subject = `[ZdexCloud] Tax Invoice Issued — ${plainInvoiceNumber}`;

  const text = `
ZdexCloud Personal File Server
===============================

${textGreeting}

Your statutory tax invoice is now ready and available in your account.

Invoice Details:
- Invoice Number: ${plainInvoiceNumber}
- Date of Issue:  ${dateStr}
- Total Amount:   ${formattedAmount}

To view and download your official PDF tax invoice, please sign in to your secure ZdexCloud account:
${portalUrl}

Security Notice:
For your privacy and security, invoice PDF documents are not sent as email attachments. You can access and download your invoices at any time directly through your authenticated ZdexCloud dashboard.

Customer Policy:
Customer payments are final. ZdexCloud does not offer refunds or refund requests after successful payment.

If you have questions regarding this invoice, please contact support@zdexcloud.com.

--
ZdexCloud Personal File Server Team
https://zdexcloud.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tax Invoice Issued — ZdexCloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <!-- Header -->
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">ZdexCloud</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <!-- Body Content -->
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; text-align: center;">Tax Invoice Issued</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px; text-align: left;">
          ${customerGreeting}
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; text-align: left;">
          Your statutory tax invoice has been generated and is now available in your ZdexCloud account.
        </p>

        <!-- Invoice Details Box -->
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 0 0 24px; font-size: 14px;">
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500;">Invoice Number</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600; text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">${safeInvoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500;">Date of Issue</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600; text-align: right;">${escapeHtml(dateStr)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 16px; color: #64748b; font-weight: 500;">Total Amount</td>
            <td style="padding: 12px 16px; color: #0284c7; font-weight: 700; text-align: right; font-size: 16px;">${escapeHtml(formattedAmount)}</td>
          </tr>
        </table>

        <!-- Portal Download CTA Button -->
        <div style="text-align: center; margin: 28px 0;">
          <a href="${safePortalUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
            View &amp; Download Invoice PDF
          </a>
        </div>

        <!-- Security Notice -->
        <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 14px 16px; margin: 0 0 20px;">
          <p style="font-size: 12px; line-height: 1.5; color: #0369a1; margin: 0;">
            <strong>Security Notice:</strong> Invoices are securely stored within your password-protected ZdexCloud portal and are not sent as email attachments. ZdexCloud will never ask for your password or credentials via email.
          </p>
        </div>

        <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0;">
          Customer payments are final. For questions regarding your invoice or billing, please contact <a href="mailto:support@zdexcloud.com" style="color: #64748b; text-decoration: underline;">support@zdexcloud.com</a>.
        </p>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 ZdexCloud Platform &bull; All Rights Reserved
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

export interface PaymentEmailTemplateParams {
  amountMinorUnits: number;
  currency: string;
  customerName?: string | null;
  planName?: string | null;
  paymentId?: string | null;
  portalUrl?: string;
  reason?: string | null;
}

/**
 * Generates the Payment Succeeded notification email template.
 */
export function getPaymentSucceededEmailTemplate(params: PaymentEmailTemplateParams): EmailTemplatePayload {
  const formattedAmount = formatAsciiCurrency(params.amountMinorUnits, params.currency);
  const portalUrl = (params.portalUrl || 'https://zdexcloud.com/pages/billing.html').trim();
  const safePortalUrl = escapeHtml(portalUrl);
  const customerGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${escapeHtml(params.customerName.trim())},`
    : 'Hello,';
  const textGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${params.customerName.trim()},`
    : 'Hello,';

  const subject = `[ZdexCloud] Payment Confirmation — ${formattedAmount}`;

  const text = `
ZdexCloud Personal File Server
===============================

${textGreeting}

Your payment of ${formattedAmount} was successfully processed.

Payment Summary:
- Amount:     ${formattedAmount}
- Plan:       ${params.planName || 'ZdexCloud Plan'}
- Status:     Confirmed & Applied

You can view your complete payment history, active entitlements, and tax invoices in your authenticated portal:
${portalUrl}

Security Notice:
ZdexCloud will never ask for your card details, banking credentials, or password via email.

If you have questions, please contact support@zdexcloud.com.

--
ZdexCloud Personal File Server Team
https://zdexcloud.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Confirmation — ZdexCloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <!-- Header -->
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">ZdexCloud</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <!-- Body Content -->
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; text-align: center;">Payment Confirmation</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px; text-align: left;">
          ${customerGreeting}
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; text-align: left;">
          Your payment of <strong>${escapeHtml(formattedAmount)}</strong> has been processed successfully.
        </p>

        <!-- Payment Details Table -->
        <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 0 0 24px; font-size: 14px;">
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500;">Amount Paid</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #059669; font-weight: 700; text-align: right; font-size: 16px;">${escapeHtml(formattedAmount)}</td>
          </tr>
          ${params.planName ? `
          <tr>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-weight: 500;">Plan</td>
            <td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600; text-align: right;">${escapeHtml(params.planName)}</td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding: 12px 16px; color: #64748b; font-weight: 500;">Status</td>
            <td style="padding: 12px 16px; color: #059669; font-weight: 600; text-align: right;">Confirmed</td>
          </tr>
        </table>

        <!-- Portal CTA Button -->
        <div style="text-align: center; margin: 28px 0;">
          <a href="${safePortalUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
            View Billing Dashboard
          </a>
        </div>

        <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0;">
          Customer payments are final. For questions regarding your payment, please contact <a href="mailto:support@zdexcloud.com" style="color: #64748b; text-decoration: underline;">support@zdexcloud.com</a>.
        </p>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 ZdexCloud Platform &bull; All Rights Reserved
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

/**
 * Generates the Payment Failed notification email template.
 */
export function getPaymentFailedEmailTemplate(params: PaymentEmailTemplateParams): EmailTemplatePayload {
  const portalUrl = (params.portalUrl || 'https://zdexcloud.com/pages/billing.html').trim();
  const safePortalUrl = escapeHtml(portalUrl);
  const customerGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${escapeHtml(params.customerName.trim())},`
    : 'Hello,';
  const textGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${params.customerName.trim()},`
    : 'Hello,';
  const reasonText = params.reason ? escapeHtml(params.reason) : 'Your card or payment instrument was declined by the issuer.';

  const subject = '[ZdexCloud] Action Required: Payment Failed';

  const text = `
ZdexCloud Personal File Server
===============================

${textGreeting}

Your recent payment could not be processed.

Reason: ${params.reason || 'Payment was declined by issuer.'}

To avoid service disruption or account downgrades, please update your payment method:
${portalUrl}

If you need assistance, please contact support@zdexcloud.com.

--
ZdexCloud Personal File Server Team
https://zdexcloud.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Failed — ZdexCloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">ZdexCloud</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #dc2626; margin: 0 0 12px; text-align: center;">Payment Authorization Failed</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px;">
          ${customerGreeting}
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px;">
          We were unable to process your payment. ${reasonText} Please update your payment method to maintain uninterrupted service.
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${safePortalUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #dc2626; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
            Update Payment Method
          </a>
        </div>

        <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0;">
          Need assistance? Please contact <a href="mailto:support@zdexcloud.com" style="color: #64748b; text-decoration: underline;">support@zdexcloud.com</a>.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 ZdexCloud Platform &bull; All Rights Reserved
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

export interface SubscriptionEmailTemplateParams {
  customerName?: string | null;
  planName: string;
  portalUrl?: string;
  formattedAmount?: string;
  currency?: string;
  gracePeriodEndsAt?: Date | string;
  customSummary?: string;
}

/**
 * Generates the Subscription Activated notification email template.
 */
export function getSubscriptionActivatedEmailTemplate(params: SubscriptionEmailTemplateParams): EmailTemplatePayload {
  const portalUrl = (params.portalUrl || 'https://zdexcloud.com/pages/subscription.html').trim();
  const safePortalUrl = escapeHtml(portalUrl);
  const customerGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${escapeHtml(params.customerName.trim())},`
    : 'Hello,';
  const textGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${params.customerName.trim()},`
    : 'Hello,';
  const safePlanName = escapeHtml(params.planName || 'Pro');

  const subject = `[ZdexCloud] Welcome to ZdexCloud ${params.planName || 'Pro'}`;

  const text = `
ZdexCloud Personal File Server
===============================

${textGreeting}

Your ZdexCloud ${params.planName || 'Pro'} subscription is now active!

You now have access to priority routing and expanded server hosting on your Android phone hardware.

Manage your subscription and servers:
${portalUrl}

--
ZdexCloud Personal File Server Team
https://zdexcloud.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Subscription Activated — ZdexCloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">ZdexCloud</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; text-align: center;">Subscription Activated</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px;">
          ${customerGreeting}
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px;">
          Your ZdexCloud <strong>${safePlanName}</strong> subscription is now active with full priority routing and multi-server capacity.
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${safePortalUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
            Manage Subscription &amp; Servers
          </a>
        </div>

        <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0;">
          Hardware Storage Guarantee: All personal files remain stored on your physical Android device.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 ZdexCloud Platform &bull; All Rights Reserved
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

/**
 * Generates the Subscription Renewed notification email template.
 */
export function getSubscriptionRenewedEmailTemplate(params: SubscriptionEmailTemplateParams): EmailTemplatePayload {
  const portalUrl = (params.portalUrl || 'https://zdexcloud.com/pages/subscription.html').trim();
  const safePortalUrl = escapeHtml(portalUrl);
  const customerGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${escapeHtml(params.customerName.trim())},`
    : 'Hello,';
  const textGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${params.customerName.trim()},`
    : 'Hello,';
  const safePlanName = escapeHtml(params.planName || 'Pro');

  const subject = `[ZdexCloud] Subscription Renewal Confirmation — ${params.planName || 'Pro'}`;

  const text = `
ZdexCloud Personal File Server
===============================

${textGreeting}

Your recurring subscription for ${params.planName || 'ZdexCloud Pro'} has been renewed successfully.
${params.formattedAmount ? `Amount: ${params.currency || 'USD'} ${params.formattedAmount}\n` : ''}
Manage your subscription and view invoices:
${portalUrl}

--
ZdexCloud Personal File Server Team
https://zdexcloud.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Subscription Renewed — ZdexCloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">ZdexCloud</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; text-align: center;">Subscription Renewed</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px;">
          ${customerGreeting}
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px;">
          Your recurring subscription for <strong>${safePlanName}</strong> has been renewed successfully.
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${safePortalUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
            Manage Subscription
          </a>
        </div>

        <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0;">
          Invoices and receipts can be downloaded at any time from your account dashboard.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 ZdexCloud Platform &bull; All Rights Reserved
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

/**
 * Generates the Subscription Dunning / Payment Failure notification email template.
 */
export function getSubscriptionDunningEmailTemplate(params: SubscriptionEmailTemplateParams): EmailTemplatePayload {
  const portalUrl = (params.portalUrl || 'https://zdexcloud.com/pages/billing.html').trim();
  const safePortalUrl = escapeHtml(portalUrl);
  const customerGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${escapeHtml(params.customerName.trim())},`
    : 'Hello,';
  const textGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${params.customerName.trim()},`
    : 'Hello,';
  const safePlanName = escapeHtml(params.planName || 'Pro');
  const dateStr = params.gracePeriodEndsAt ? formatTemplateDate(params.gracePeriodEndsAt) : 'soon';

  const subject = `[ZdexCloud] Urgent: Renewal Payment Failed for ${params.planName || 'Subscription'}`;

  const text = `
ZdexCloud Personal File Server
===============================

${textGreeting}

Urgent: Your recurring renewal payment for ZdexCloud ${params.planName || 'Subscription'} failed.

Your paid features remain active during your 5-day grace period (until ${dateStr}).

Please update your payment method to avoid service interruption:
${portalUrl}

--
ZdexCloud Personal File Server Team
https://zdexcloud.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Subscription Renewal Failed — ZdexCloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">ZdexCloud</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #dc2626; margin: 0 0 12px; text-align: center;">Subscription Renewal Failed</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px;">
          ${customerGreeting}
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px;">
          Your recurring renewal payment for ZdexCloud <strong>${safePlanName}</strong> could not be processed. Paid features remain active during your 5-day grace period (until ${escapeHtml(dateStr)}).
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${safePortalUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #dc2626; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
            Resolve Payment
          </a>
        </div>

        <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0;">
          If payment is not completed before the grace period ends, your account will revert to the Free tier.
        </p>
      </td>
    </tr>
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 ZdexCloud Platform &bull; All Rights Reserved
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

/**
 * Generates the Subscription Expired notification email template.
 */
export function getSubscriptionExpiredEmailTemplate(params: SubscriptionEmailTemplateParams): EmailTemplatePayload {
  const portalUrl = (params.portalUrl || 'https://zdexcloud.com/pages/subscription.html').trim();
  const safePortalUrl = escapeHtml(portalUrl);
  const customerGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${escapeHtml(params.customerName.trim())},`
    : 'Hello,';
  const textGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${params.customerName.trim()},`
    : 'Hello,';
  const safePlanName = escapeHtml(params.planName || 'Pro');

  const subject = '[ZdexCloud] Subscription Expired — Account Reverted to Free Plan';

  const text = `
ZdexCloud Personal File Server
===============================

${textGreeting}

Your ZdexCloud ${params.planName || 'Pro'} subscription has ended and your account has reverted to the Free tier.

Hardware Storage Guarantee:
All your servers and files remain completely safe and intact on your phone hardware.

You can upgrade your subscription at any time:
${portalUrl}

--
ZdexCloud Personal File Server Team
https://zdexcloud.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Subscription Expired — ZdexCloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">ZdexCloud</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #dc2626; margin: 0 0 12px; text-align: center;">Subscription Expired</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px;">
          ${customerGreeting}
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px;">
          Your ZdexCloud <strong>${safePlanName}</strong> subscription period has ended, and your account has reverted to the Free tier (1 server limit).
        </p>

        <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px; padding: 14px 16px; margin: 0 0 20px;">
          <p style="font-size: 12px; line-height: 1.5; color: #065f46; margin: 0;">
            <strong>Hardware Storage Guarantee:</strong> All personal files and configured servers remain safe and strictly stored on your phone hardware.
          </p>
        </div>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${safePortalUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
            Upgrade Subscription
          </a>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 ZdexCloud Platform &bull; All Rights Reserved
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}

/**
 * Generates the Refund Processed notification email template.
 */
export function getRefundProcessedEmailTemplate(params: PaymentEmailTemplateParams): EmailTemplatePayload {
  const formattedAmount = formatAsciiCurrency(params.amountMinorUnits, params.currency);
  const portalUrl = (params.portalUrl || 'https://zdexcloud.com/pages/billing.html').trim();
  const safePortalUrl = escapeHtml(portalUrl);
  const customerGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${escapeHtml(params.customerName.trim())},`
    : 'Hello,';
  const textGreeting = params.customerName && params.customerName.trim()
    ? `Hello ${params.customerName.trim()},`
    : 'Hello,';

  const subject = `[ZdexCloud] Refund Processed — ${formattedAmount}`;

  const text = `
ZdexCloud Personal File Server
===============================

${textGreeting}

Your refund of ${formattedAmount} has been processed successfully.

The refunded amount should reflect in your original payment method in accordance with your bank or card issuer's processing timelines.

View your billing activity:
${portalUrl}

--
ZdexCloud Personal File Server Team
https://zdexcloud.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Refund Processed — ZdexCloud</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 540px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">ZdexCloud</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; text-align: center;">Refund Processed</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 20px;">
          ${customerGreeting}
        </p>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px;">
          Your refund of <strong>${escapeHtml(formattedAmount)}</strong> has been processed successfully. It should reflect in your original payment method according to your financial institution's processing schedule.
        </p>

        <div style="text-align: center; margin: 28px 0;">
          <a href="${safePortalUrl}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #0284c7; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 12px 28px; border-radius: 6px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);">
            View Billing Dashboard
          </a>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 ZdexCloud Platform &bull; All Rights Reserved
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}
