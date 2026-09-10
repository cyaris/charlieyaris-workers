const MAX_REQUEST_BYTES = 16_384;
const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails';
const SITEVERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const escapeHtml = (value) =>
	String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const asText = (value) => (typeof value === 'string' ? value : '');

function logError(event, details = {}) {
	console.error(JSON.stringify({ event, ...details }));
}

async function readJsonBody(request) {
	const contentLength = Number(request.headers.get('Content-Length'));

	if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
		return { error: 'too-large' };
	}

	if (!request.body) {
		return { error: 'malformed' };
	}

	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let body = '';
	let bytesRead = 0;

	try {
		while (true) {
			const { done, value } = await reader.read();

			if (done) {
				break;
			}

			bytesRead += value.byteLength;
			if (bytesRead > MAX_REQUEST_BYTES) {
				await reader.cancel();

				return { error: 'too-large' };
			}

			body += decoder.decode(value, { stream: true });
		}

		body += decoder.decode();

		return { value: JSON.parse(body) };
	} catch {
		return { error: 'malformed' };
	}
}

async function verifyTurnstile(token, ip, secretKey) {
	const formData = new FormData();

	formData.append('idempotency_key', crypto.randomUUID());
	formData.append('response', token);
	formData.append('secret', secretKey);

	if (ip) {
		formData.append('remoteip', ip);
	}

	let response;

	try {
		response = await fetch(SITEVERIFY_ENDPOINT, { method: 'POST', body: formData });
	} catch (error) {
		logError('turnstile_network_error', { message: error instanceof Error ? error.message : 'Unknown error' });

		return { error: 'network' };
	}

	if (!response.ok) {
		logError('turnstile_http_error', { status: response.status });

		return { error: 'http' };
	}

	let result;

	try {
		result = await response.json();
	} catch {
		logError('turnstile_malformed_response');

		return { error: 'malformed' };
	}

	if (
		result == null ||
		typeof result !== 'object' ||
		typeof result.success !== 'boolean' ||
		(result.success && (typeof result.hostname !== 'string' || typeof result.action !== 'string'))
	) {
		logError('turnstile_unexpected_response');

		return { error: 'malformed' };
	}

	return {
		action: result.action ?? '',
		errorCodes: Array.isArray(result['error-codes']) ? result['error-codes'].filter((errorCode) => typeof errorCode === 'string') : [],
		hostname: result.hostname ?? '',
		success: result.success,
	};
}

async function sendResendEmail(apiKey, email) {
	return fetch(RESEND_EMAILS_ENDPOINT, {
		method: 'POST',
		headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(email),
	});
}

function createJsonResponse(config, body, status, origin = '') {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Access-Control-Allow-Origin': config.allowedOrigins.has(origin) ? origin : config.primaryOrigin,
			'Access-Control-Allow-Methods': 'POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			'Content-Type': 'application/json',
			Vary: 'Origin',
		},
	});
}

export function createContactWorker(options) {
	const config = {
		...options,
		allowedOrigins: new Set(options.allowedOrigins),
		allowedTurnstileHostnames: new Set(options.allowedTurnstileHostnames),
	};

	return {
		async fetch(request, env) {
			const origin = request.headers.get('Origin') ?? '';
			const allowedOrigins =
				env.CONTACT_ENVIRONMENT === 'development'
					? new Set([...config.allowedOrigins, ...(config.developmentOrigins ?? [])])
					: config.allowedOrigins;
			const allowedTurnstileHostnames =
				env.CONTACT_ENVIRONMENT === 'development'
					? new Set([...config.allowedTurnstileHostnames, ...(config.developmentTurnstileHostnames ?? [])])
					: config.allowedTurnstileHostnames;
			const requestConfig = { ...config, allowedOrigins };

			if (request.method === 'OPTIONS') {
				if (!allowedOrigins.has(origin)) {
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
				return createJsonResponse(requestConfig, { error: 'Method not allowed.' }, 405, origin);
			}

			if (!allowedOrigins.has(origin)) {
				return createJsonResponse(requestConfig, { error: 'Origin not allowed.' }, 403, origin);
			}

			const turnstileSecret = env[config.turnstileSecretBinding];

			if (!env.RESEND_API_KEY || !turnstileSecret || !env.CONTACT_FROM_EMAIL || !env.CONTACT_TO_EMAIL) {
				logError('missing_worker_binding', { product: config.productName });

				return createJsonResponse(
					requestConfig,
					{ error: 'The contact service is temporarily unavailable. Please try again later.' },
					500,
					origin,
				);
			}

			if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
				return createJsonResponse(requestConfig, { error: 'Content-Type must be application/json.' }, 415, origin);
			}

			const parsedBody = await readJsonBody(request);

			if (parsedBody.error === 'too-large') {
				return createJsonResponse(requestConfig, { error: 'Request body is too large.' }, 413, origin);
			}

			if (parsedBody.error || parsedBody.value == null || typeof parsedBody.value !== 'object' || Array.isArray(parsedBody.value)) {
				return createJsonResponse(requestConfig, { error: 'Invalid request body.' }, 400, origin);
			}

			const { name, email, subject, message, website = '', turnstileToken } = parsedBody.value;

			if ([name, email, subject, message, website, turnstileToken].some((value) => typeof value !== 'string')) {
				return createJsonResponse(requestConfig, { error: 'Invalid request body.' }, 400, origin);
			}

			// Humans never fill in this field, so acknowledge bots without spending provider requests.
			if (website) {
				return createJsonResponse(requestConfig, { success: true, message: 'Your message has been sent.' }, 200, origin);
			}

			const trimmedName = asText(name).trim();
			const trimmedEmail = asText(email).trim();
			const trimmedSubject = asText(subject).trim();
			const trimmedMessage = asText(message).trim();
			const trimmedTurnstileToken = asText(turnstileToken).trim();

			if (!trimmedName || !trimmedEmail || !trimmedSubject || !trimmedMessage) {
				return createJsonResponse(requestConfig, { error: 'Please complete every required field.' }, 400, origin);
			}

			if (!isValidEmail(trimmedEmail)) {
				return createJsonResponse(requestConfig, { error: 'Please enter a valid email address.' }, 400, origin);
			}

			if (
				trimmedName.length > 100 ||
				trimmedEmail.length > 254 ||
				trimmedSubject.length > 150 ||
				trimmedMessage.length > 5000 ||
				trimmedTurnstileToken.length > 2048
			) {
				return createJsonResponse(requestConfig, { error: 'One or more fields are too long.' }, 400, origin);
			}

			if (/\r|\n/.test(trimmedSubject)) {
				return createJsonResponse(requestConfig, { error: 'Subject must be a single line.' }, 400, origin);
			}

			if (!trimmedTurnstileToken) {
				return createJsonResponse(requestConfig, { error: 'Spam verification is required.' }, 400, origin);
			}

			const turnstile = await verifyTurnstile(trimmedTurnstileToken, request.headers.get('CF-Connecting-IP') ?? '', turnstileSecret);

			if (
				turnstile.error ||
				!turnstile.success ||
				!allowedTurnstileHostnames.has(turnstile.hostname) ||
				(config.turnstileAction && turnstile.action !== config.turnstileAction)
			) {
				logError('turnstile_validation_failed', {
					action: turnstile.action ?? '',
					error: turnstile.error ?? '',
					errorCodes: turnstile.errorCodes ?? [],
					hostname: turnstile.hostname ?? '',
					product: config.productName,
				});

				return createJsonResponse(requestConfig, { error: 'Spam verification failed. Please try again.' }, 403, origin);
			}

			const safeName = escapeHtml(trimmedName);
			const safeEmail = escapeHtml(trimmedEmail);
			const safeSubject = escapeHtml(trimmedSubject);
			const safeMessage = escapeHtml(trimmedMessage).replace(/\r?\n/g, '<br>');

			let contactResponse;

			try {
				contactResponse = await sendResendEmail(env.RESEND_API_KEY, {
					from: env.CONTACT_FROM_EMAIL,
					to: [env.CONTACT_TO_EMAIL],
					reply_to: trimmedEmail,
					subject: `${config.notificationSubjectPrefix}: ${trimmedSubject}`,
					text: [
						config.notificationHeading,
						'',
						`Name: ${trimmedName}`,
						`Email: ${trimmedEmail}`,
						`Subject: ${trimmedSubject}`,
						'',
						trimmedMessage,
					].join('\n'),
					html: `
						<h2>${escapeHtml(config.notificationHeading)}</h2>

						<p><strong>Name:</strong> ${safeName}</p>
						<p><strong>Email:</strong> ${safeEmail}</p>
						<p><strong>Subject:</strong> ${safeSubject}</p>

						<hr>

						<p>${safeMessage}</p>
					`,
				});
			} catch (error) {
				logError('resend_contact_network_error', {
					message: error instanceof Error ? error.message : 'Unknown error',
					product: config.productName,
				});

				return createJsonResponse(requestConfig, { error: 'The message could not be sent. Please try again later.' }, 502, origin);
			}

			if (!contactResponse.ok) {
				logError('resend_contact_http_error', { product: config.productName, status: contactResponse.status });

				return createJsonResponse(requestConfig, { error: 'The message could not be sent. Please try again later.' }, 502, origin);
			}

			try {
				const confirmationResponse = await sendResendEmail(env.RESEND_API_KEY, {
					from: env.CONTACT_FROM_EMAIL,
					to: [trimmedEmail],
					reply_to: env.CONTACT_TO_EMAIL,
					subject: config.confirmationSubject,
					text: [
						`Hi ${trimmedName},`,
						'',
						config.confirmationIntroduction,
						'',
						'Here is a copy of your message:',
						'',
						`Subject: ${trimmedSubject}`,
						'',
						trimmedMessage,
						'',
						config.signatureName,
						config.signatureUrl,
					].join('\n'),
					html: `
						<p>Hi ${safeName},</p>

						<p>${escapeHtml(config.confirmationIntroduction)}</p>

						<p><strong>Here is a copy of your message:</strong></p>

						<blockquote style="margin: 0.25rem 0; padding-left: 0.5rem; border-left: 3px solid #cccccc;">
							<p style="margin: 0 0 0.25rem;"><strong>Subject:</strong> ${safeSubject}</p>
							<p style="margin: 0;">${safeMessage}</p>
						</blockquote>

						<p>
							${escapeHtml(config.signatureName)}<br>
							<a href="${escapeHtml(config.signatureUrl)}">${escapeHtml(config.signatureUrlLabel)}</a>
						</p>
					`,
				});

				if (!confirmationResponse.ok) {
					logError('resend_confirmation_http_error', {
						product: config.productName,
						status: confirmationResponse.status,
					});
				}
			} catch (error) {
				logError('resend_confirmation_network_error', {
					message: error instanceof Error ? error.message : 'Unknown error',
					product: config.productName,
				});
			}

			return createJsonResponse(requestConfig, { success: true, message: 'Your message has been sent.' }, 200, origin);
		},
	};
}
