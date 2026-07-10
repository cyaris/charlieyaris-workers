const ALLOWED_ORIGINS = new Set([
	'https://charlieyaris.com',
	'https://www.charlieyaris.com',
	'https://cyaris.github.io',
	'http://localhost:4000',
	'http://127.0.0.1:4000',
]);

const ALLOWED_TURNSTILE_HOSTNAMES = new Set(['charlieyaris.com', 'www.charlieyaris.com', 'localhost', '127.0.0.1']);

const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails';

const jsonResponse = (body, status, origin = '') =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://charlieyaris.com',
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			Vary: 'Origin',
		},
	});

const escapeHtml = (value) =>
	String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

async function verifyTurnstile(token, ip, secretKey) {
	if (!secretKey) {
		return { success: false, hostname: '', errorCodes: ['missing-secret-key'] };
	}

	const formData = new FormData();

	formData.append('secret', secretKey);
	formData.append('response', token);

	if (ip) {
		formData.append('remoteip', ip);
	}

	try {
		const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: formData });

		if (!response.ok) {
			return { success: false, hostname: '', errorCodes: ['siteverify-request-failed'] };
		}

		const result = await response.json();

		return { success: result.success === true, hostname: result.hostname ?? '', errorCodes: result['error-codes'] ?? [] };
	} catch (error) {
		console.error('Turnstile request failed:', error);

		return { success: false, hostname: '', errorCodes: ['siteverify-request-error'] };
	}
}

async function sendResendEmail(apiKey, email) {
	return fetch(RESEND_EMAILS_ENDPOINT, {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(email),
	});
}

export default {
	async fetch(request, env) {
		const origin = request.headers.get('Origin') ?? '';

		if (request.method === 'OPTIONS') {
			if (!ALLOWED_ORIGINS.has(origin)) {
				return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
			}

			return new Response(null, {
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': origin,
					'Access-Control-Allow-Methods': 'POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
					'Access-Control-Max-Age': '86400',
					Vary: 'Origin',
				},
			});
		}

		if (request.method !== 'POST') {
			return jsonResponse({ error: 'Method not allowed.' }, 405, origin);
		}

		if (!ALLOWED_ORIGINS.has(origin)) {
			return jsonResponse({ error: 'Origin not allowed.' }, 403, origin);
		}

		if (!env.RESEND_API_KEY || !env.TURNSTILE_SECRET_KEY || !env.CONTACT_FROM_EMAIL || !env.CONTACT_TO_EMAIL) {
			console.error('One or more required Worker bindings are missing.');
			return jsonResponse({ error: 'The contact service is temporarily unavailable. Please try again later.' }, 500, origin);
		}

		let payload;

		try {
			payload = await request.json();
		} catch {
			return jsonResponse({ error: 'Invalid request body.' }, 400, origin);
		}

		const { name = '', email = '', subject = '', message = '', website = '', turnstileToken = '' } = payload;

		// Honeypot field. Humans should never fill this in.
		if (website) {
			return jsonResponse({ success: true, message: 'Your message has been sent.' }, 200, origin);
		}

		const trimmedName = String(name).trim();
		const trimmedEmail = String(email).trim();
		const trimmedSubject = String(subject).trim();
		const trimmedMessage = String(message).trim();
		const trimmedTurnstileToken = String(turnstileToken).trim();

		if (!trimmedName || !trimmedEmail || !trimmedSubject || !trimmedMessage) {
			return jsonResponse({ error: 'Please complete every required field.' }, 400, origin);
		}

		if (!isValidEmail(trimmedEmail)) {
			return jsonResponse({ error: 'Please enter a valid email address.' }, 400, origin);
		}

		if (trimmedName.length > 100 || trimmedEmail.length > 254 || trimmedSubject.length > 150 || trimmedMessage.length > 5000) {
			return jsonResponse({ error: 'One or more fields are too long.' }, 400, origin);
		}

		if (!trimmedTurnstileToken) {
			return jsonResponse({ error: 'Spam verification is required.' }, 400, origin);
		}

		const ip = request.headers.get('CF-Connecting-IP') ?? '';

		const turnstile = await verifyTurnstile(trimmedTurnstileToken, ip, env.TURNSTILE_SECRET_KEY);

		if (!turnstile.success || !ALLOWED_TURNSTILE_HOSTNAMES.has(turnstile.hostname)) {
			console.error('Turnstile validation failed:', turnstile);

			return jsonResponse({ error: 'Spam verification failed. Please try again.' }, 403, origin);
		}

		const safeName = escapeHtml(trimmedName);
		const safeEmail = escapeHtml(trimmedEmail);
		const safeSubject = escapeHtml(trimmedSubject);
		const safeMessage = escapeHtml(trimmedMessage).replace(/\r?\n/g, '<br>');

		/*
		 * Send the contact-form submission to Charlie.
		 *
		 * The email is sent from the verified Resend domain. The visitor's
		 * email is used as Reply-To so replying from the inbox responds
		 * directly to the visitor.
		 */
		let contactResponse;

		try {
			contactResponse = await sendResendEmail(env.RESEND_API_KEY, {
				from: env.CONTACT_FROM_EMAIL,
				to: [env.CONTACT_TO_EMAIL],
				reply_to: trimmedEmail,
				subject: `Website contact: ${trimmedSubject}`,
				text: [
					'New website contact',
					'',
					`Name: ${trimmedName}`,
					`Email: ${trimmedEmail}`,
					`Subject: ${trimmedSubject}`,
					'',
					trimmedMessage,
				].join('\n'),
				html: `
            <h2>New website contact</h2>

            <p><strong>Name:</strong> ${safeName}</p>
            <p><strong>Email:</strong> ${safeEmail}</p>
            <p><strong>Subject:</strong> ${safeSubject}</p>

            <hr>

            <p>${safeMessage}</p>
          `,
			});
		} catch (error) {
			console.error('Resend contact-email request failed:', error);

			return jsonResponse({ error: 'The message could not be sent. Please try again later.' }, 502, origin);
		}

		if (!contactResponse.ok) {
			const resendError = await contactResponse.text();

			console.error('Resend contact-email error:', resendError);

			return jsonResponse({ error: 'The message could not be sent. Please try again later.' }, 502, origin);
		}

		/*
		 * Send a confirmation email to the visitor.
		 *
		 * This is intentionally best-effort. The original message has
		 * already been delivered to Charlie, so a confirmation failure
		 * should not make the form submission appear unsuccessful.
		 */
		try {
			const confirmationResponse = await sendResendEmail(env.RESEND_API_KEY, {
				from: env.CONTACT_FROM_EMAIL,
				to: [trimmedEmail],
				reply_to: env.CONTACT_TO_EMAIL,
				subject: 'Thanks for reaching out!',
				text: [
					`Hi ${trimmedName},`,
					'',
					'Thanks for reaching out! I received your message and will get back to you as soon as I can.',
					'',
					'Here is a copy of your message:',
					'',
					`Subject: ${trimmedSubject}`,
					'',
					trimmedMessage,
					'',
					'Charlie Yaris',
					'https://charlieyaris.com',
				].join('\n'),
				html: `
          <p>Hi ${safeName},</p>

          <p>Thanks for reaching out! I received your message and will get back to you as soon as I can.</p>

          <p><strong>Here is a copy of your message:</strong></p>

          <blockquote
            style="
              margin: 0.25rem 0;
              padding-left: 0.5rem;
              border-left: 3px solid #cccccc;
            "
          >
            <p style="margin: 0 0 0.25rem;"><strong>Subject:</strong> ${safeSubject}</p>
            <p style="margin: 0;">${safeMessage}</p>
          </blockquote>

          <p>
            Charlie Yaris<br>
            <a href="https://charlieyaris.com">charlieyaris.com</a>
          </p>
          `,
			});

			if (!confirmationResponse.ok) {
				const confirmationError = await confirmationResponse.text();

				console.error('Resend confirmation-email error:', confirmationError);
			}
		} catch (error) {
			console.error('Resend confirmation-email request failed:', error);
		}

		return jsonResponse({ success: true, message: 'Your message has been sent.' }, 200, origin);
	},
};
