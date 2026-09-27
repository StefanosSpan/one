// Transactional e-mail (password reset, welcome, new sign-up notice).
// Sent through Resend (https://resend.com) when RESEND_API_KEY is set; otherwise printed to the console.
export async function sendMail({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) {
    console.log(`\n[email] To: ${to}\n[email] ${subject}\n${text}\n`);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'Kalimenu <onboarding@resend.dev>', to, subject, text }),
    });
    if (!res.ok) console.error('[email] failed', res.status, await res.text());
  } catch (e) {
    console.error('[email] failed', e.message);
  }
}
