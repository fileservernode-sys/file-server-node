/**
 * Responsive HTML & Plain-Text Email Templates for RemoteNode Platform
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
  const subject = `[RemoteNode] Your Verification Code: ${otpCode}`;

  const text = `
RemoteNode Personal File Server
===============================

Your 6-digit email verification code is:

${otpCode}

This code will expire in ${expiryMinutes} minutes.

Enter this code on the RemoteNode verification screen to complete your registration.

Security Notice:
If you did not create an account with RemoteNode, please disregard this message. Do not share this code with anyone.

--
RemoteNode Personal File Server Team
https://viewduration.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email — RemoteNode</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <!-- Header -->
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">RemoteNode</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <!-- Body Content -->
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; text-align: center;">Verify Your Email Address</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; text-align: center;">
          Thank you for registering with RemoteNode. Please enter the 6-digit verification code below on your setup screen to activate your account:
        </p>
        
        <!-- OTP Code Box -->
        <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; text-align: center; margin: 0 0 24px;">
          <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #0284c7; display: block; margin-left: 8px;">${otpCode}</span>
          <span style="font-size: 12px; font-weight: 600; color: #0369a1; text-transform: uppercase; letter-spacing: 0.05em; display: inline-block; margin-top: 8px;">Valid for ${expiryMinutes} minutes</span>
        </div>

        <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin: 0 0 12px;">
          <strong>Security Note:</strong> RemoteNode will never ask for your verification code via phone, chat, or external message. Do not share this code.
        </p>
        <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; margin: 0;">
          If you did not request this registration, you can safely ignore this email.
        </p>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 RemoteNode Platform &bull; Testing & Staging Environment
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
  const subject = `[RemoteNode] Password Reset Code: ${otpCode}`;

  const text = `
RemoteNode Personal File Server
===============================

A password reset was requested for your RemoteNode account.

Your 6-digit password reset code is:

${otpCode}

This code will expire in ${expiryMinutes} minutes.

Enter this code on the password reset screen along with your new password.

Security Warning:
If you did not request a password reset, someone may be attempting to access your account. Please ensure your email is secure. Do not share this code with anyone.

--
RemoteNode Personal File Server Team
https://viewduration.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password — RemoteNode</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <!-- Header -->
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">RemoteNode</div>
        <div style="font-size: 13px; color: #64748b; margin-top: 2px;">Personal File Server Platform</div>
      </td>
    </tr>
    <!-- Body Content -->
    <tr>
      <td style="padding: 32px;">
        <h1 style="font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 12px; text-align: center;">Reset Your Account Password</h1>
        <p style="font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 24px; text-align: center;">
          We received a request to reset the password for your RemoteNode account. Use the 6-digit code below to set a new password:
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
          RemoteNode will never ask for this code. Do not share it with anyone.
        </p>
      </td>
    </tr>
    <!-- Footer -->
    <tr>
      <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center; font-size: 12px; color: #94a3b8;">
        &copy; 2026 RemoteNode Platform &bull; Testing & Staging Environment
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
  const subject = `[RemoteNode] Your Login Security Code: ${otpCode}`;

  const text = `
RemoteNode Personal File Server
===============================

Your 6-digit login verification code is:

${otpCode}

This code will expire in ${expiryMinutes} minutes.

Enter this code on the RemoteNode login screen to access your account.

Security Notice:
If you did not attempt to sign in to RemoteNode, please change your password immediately.

--
RemoteNode Personal File Server Team
https://viewduration.com
`.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Security Code — RemoteNode</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 16px; color: #0f172a;">
  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.05);">
    <!-- Header -->
    <tr>
      <td style="padding: 32px 32px 20px; text-align: center; border-bottom: 1px solid #f1f5f9;">
        <div style="display: inline-block; background-color: #0284c7; color: #ffffff; font-weight: 800; font-size: 18px; line-height: 36px; width: 36px; height: 36px; border-radius: 8px; text-align: center; margin-bottom: 8px;">RN</div>
        <div style="font-size: 20px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em;">RemoteNode</div>
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
        &copy; 2026 RemoteNode Platform &bull; Testing & Staging Environment
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

  return { subject, html, text };
}
