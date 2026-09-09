import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import fantasyPlaytimeWorker from '../src/fantasy-playtime.js';
import charlieWorker from '../src/index.js';

const CHARLIE_ORIGIN = 'https://charlieyaris.com';
const charlieEnv = {
	CONTACT_FROM_EMAIL: 'Website Contact <contact@mail.charlieyaris.com>',
	CONTACT_TO_EMAIL: 'charlieyaris@gmail.com',
	RESEND_API_KEY: 'test-resend-key',
	TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
};
const fantasyEnv = {
	CONTACT_FROM_EMAIL: 'Fantasy Playtime <contact@fantasyplaytime.com>',
	CONTACT_TO_EMAIL: 'charlieyaris@gmail.com',
	RESEND_API_KEY: 'fantasy-test-resend-key',
	TURNSTILE_SECRET: 'fantasy-test-turnstile-secret',
};

const validPayload = () => ({
	name: '  Ada Lovelace  ',
	email: '  ada@example.com  ',
	subject: '  Hello  ',
	message: '  A message with real content.  ',
	website: '',
	turnstileToken: '  a-turnstile-token  ',
});

const postRequest = (body, { origin = CHARLIE_ORIGIN, headers = {} } = {}) =>
	new Request('https://contact-worker.example/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
		body: JSON.stringify(body),
	});

async function fetchHandler(worker, request, env) {
	const context = createExecutionContext();
	const response = await worker.fetch(request, env, context);
	await waitOnExecutionContext(context);

	return response;
}

function mockOutboundFetch({
	confirmationOk = true,
	resendOk = true,
	turnstileAction = '',
	turnstileBody,
	turnstileHostname = 'charlieyaris.com',
	turnstileOk = true,
	turnstileSuccess = true,
} = {}) {
	const calls = [];

	vi.stubGlobal(
		'fetch',
		vi.fn(async (url, init) => {
			calls.push({ url: String(url), init });

			if (String(url).includes('challenges.cloudflare.com')) {
				return new Response(
					turnstileBody ??
						JSON.stringify({
							action: turnstileAction,
							hostname: turnstileSuccess ? turnstileHostname : '',
							success: turnstileSuccess,
							'error-codes': turnstileSuccess ? [] : ['invalid-input-response'],
						}),
					{ status: turnstileOk ? 200 : 502 },
				);
			}

			const resendCallCount = calls.filter((call) => call.url.includes('api.resend.com')).length;

			return new Response(JSON.stringify({ id: 'email-id' }), {
				status: (resendCallCount > 1 ? confirmationOk : resendOk) ? 200 : 502,
			});
		}),
	);

	return calls;
}

const fetchCharlie = (request, env = charlieEnv) => fetchHandler(charlieWorker, request, env);
const fetchFantasy = (request, env = fantasyEnv) => fetchHandler(fantasyPlaytimeWorker, request, env);

describe('shared contact worker behavior', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('handles allowed and rejected CORS preflight requests', async () => {
		const allowed = await fetchCharlie(
			new Request('https://contact-worker.example/', { method: 'OPTIONS', headers: { Origin: CHARLIE_ORIGIN } }),
		);
		const rejected = await fetchCharlie(
			new Request('https://contact-worker.example/', {
				method: 'OPTIONS',
				headers: { Origin: 'https://evil.example' },
			}),
		);

		expect(allowed.status).toBe(204);
		expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(CHARLIE_ORIGIN);
		expect(rejected.status).toBe(403);
	});

	it('rejects unsupported methods and unknown origins', async () => {
		const methodResponse = await fetchCharlie(
			new Request('https://contact-worker.example/', { method: 'GET', headers: { Origin: CHARLIE_ORIGIN } }),
		);
		const originResponse = await fetchCharlie(postRequest(validPayload(), { origin: 'https://evil.example' }));

		expect(methodResponse.status).toBe(405);
		expect(originResponse.status).toBe(403);
	});

	it.each(['CONTACT_FROM_EMAIL', 'CONTACT_TO_EMAIL', 'RESEND_API_KEY', 'TURNSTILE_SECRET_KEY'])(
		'fails clearly when the %s binding is missing',
		async (binding) => {
			const response = await fetchCharlie(postRequest(validPayload()), { ...charlieEnv, [binding]: undefined });

			expect(response.status).toBe(500);
			expect(await response.json()).toEqual({
				error: 'The contact service is temporarily unavailable. Please try again later.',
			});
		},
	);

	it('rejects non-JSON, malformed JSON, and oversized request bodies', async () => {
		const nonJson = await fetchCharlie(
			new Request('https://contact-worker.example/', {
				method: 'POST',
				headers: { 'Content-Type': 'text/plain', Origin: CHARLIE_ORIGIN },
				body: 'plain text',
			}),
		);
		const malformed = await fetchCharlie(
			new Request('https://contact-worker.example/', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Origin: CHARLIE_ORIGIN },
				body: '{not valid json',
			}),
		);
		const oversized = await fetchCharlie(postRequest({ ...validPayload(), message: 'a'.repeat(17_000) }));

		expect(nonJson.status).toBe(415);
		expect(malformed.status).toBe(400);
		expect(oversized.status).toBe(413);
	});

	it('silently accepts the honeypot without calling external services', async () => {
		const calls = mockOutboundFetch();
		const response = await fetchCharlie(postRequest({ ...validPayload(), website: 'https://spam.example' }));

		expect(response.status).toBe(200);
		expect(calls).toHaveLength(0);
	});

	it.each(['name', 'email', 'subject', 'message', 'website', 'turnstileToken'])('rejects non-string %s values', async (field) => {
		const response = await fetchCharlie(postRequest({ ...validPayload(), [field]: { invalid: true } }));

		expect(response.status).toBe(400);
	});

	it('rejects missing fields, invalid email, missing verification, and header injection', async () => {
		const responses = await Promise.all([
			fetchCharlie(postRequest({ ...validPayload(), name: ' ' })),
			fetchCharlie(postRequest({ ...validPayload(), email: 'not-an-email' })),
			fetchCharlie(postRequest({ ...validPayload(), turnstileToken: ' ' })),
			fetchCharlie(postRequest({ ...validPayload(), subject: 'Hello\nBcc: victim@example.com' })),
		]);

		expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400]);
	});

	it('enforces every field length limit', async () => {
		for (const [field, value] of [
			['email', `${'a'.repeat(244)}@example.com`],
			['message', 'a'.repeat(5001)],
			['name', 'a'.repeat(101)],
			['subject', 'a'.repeat(151)],
			['turnstileToken', 'a'.repeat(2049)],
		]) {
			const response = await fetchCharlie(postRequest({ ...validPayload(), [field]: value }));

			expect(response.status, field).toBe(400);
		}
	});

	it('rejects failed, unavailable, and malformed Turnstile verification', async () => {
		for (const mockOptions of [
			{ turnstileSuccess: false },
			{ turnstileOk: false },
			{ turnstileBody: 'not json' },
			{ turnstileBody: JSON.stringify({ success: true }) },
		]) {
			mockOutboundFetch(mockOptions);
			const response = await fetchCharlie(postRequest(validPayload()));

			expect(response.status).toBe(403);
			vi.unstubAllGlobals();
		}
	});

	it('handles Turnstile and Resend network failures without exposing provider details', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Promise.reject(new Error('private Turnstile network detail'))),
		);
		const failedTurnstile = await fetchCharlie(postRequest(validPayload()));
		const failedTurnstileBody = await failedTurnstile.text();

		expect(failedTurnstile.status).toBe(403);
		expect(failedTurnstileBody).not.toContain('private Turnstile network detail');

		vi.unstubAllGlobals();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url) => {
				if (String(url).includes('challenges.cloudflare.com')) {
					return new Response(JSON.stringify({ action: '', hostname: 'charlieyaris.com', success: true }));
				}

				throw new Error('private Resend network detail');
			}),
		);
		const failedResend = await fetchCharlie(postRequest(validPayload()));
		const failedResendBody = await failedResend.text();

		expect(failedResend.status).toBe(502);
		expect(failedResendBody).not.toContain('private Resend network detail');
	});

	it('handles primary Resend failure and best-effort confirmation failure separately', async () => {
		mockOutboundFetch({ resendOk: false });
		const failedContact = await fetchCharlie(postRequest(validPayload()));

		vi.unstubAllGlobals();
		mockOutboundFetch({ confirmationOk: false });
		const failedConfirmation = await fetchCharlie(postRequest(validPayload()));

		expect(failedContact.status).toBe(502);
		expect(failedConfirmation.status).toBe(200);
	});

	it('trims values, escapes HTML, and sends both messages on success', async () => {
		const calls = mockOutboundFetch();
		const response = await fetchCharlie(
			postRequest({
				...validPayload(),
				message: '  <script>alert("message")</script>  ',
				name: '  <img src=x onerror=alert("name")>  ',
				subject: '  <b>Subject</b>  ',
			}),
		);
		const emails = calls.filter((call) => call.url.includes('api.resend.com')).map((call) => JSON.parse(call.init.body));

		expect(response.status).toBe(200);
		expect(emails).toHaveLength(2);
		expect(emails[0].reply_to).toBe('ada@example.com');
		expect(emails[0].subject).toBe('Website contact: <b>Subject</b>');
		for (const email of emails) {
			expect(email.html).not.toContain('<script>');
			expect(email.html).not.toContain('<img');
			expect(email.html).not.toContain('<b>Subject</b>');
			expect(email.html).toContain('&lt;');
		}
	});

	it('never returns provider details or secret values in errors', async () => {
		mockOutboundFetch({ resendOk: false });
		const response = await fetchCharlie(postRequest(validPayload()));
		const body = await response.text();

		expect(body).not.toContain(charlieEnv.RESEND_API_KEY);
		expect(body).not.toContain(charlieEnv.TURNSTILE_SECRET_KEY);
		expect(body).not.toContain('api.resend.com');
	});
});

describe('Fantasy Playtime contact worker', () => {
	const origin = 'https://fantasyplaytime.com';

	afterEach(() => vi.unstubAllGlobals());

	it('allows only the served production origin', async () => {
		const allowed = await fetchFantasy(
			new Request('https://contact-api.fantasyplaytime.com/', { method: 'OPTIONS', headers: { Origin: origin } }),
		);

		expect(allowed.status).toBe(204);
		expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(origin);
		expect(allowed.headers.get('Access-Control-Allow-Origin')).not.toBe('*');

		for (const rejectedOrigin of ['https://evil.example', 'https://www.fantasyplaytime.com']) {
			const response = await fetchFantasy(postRequest(validPayload(), { origin: rejectedOrigin }));

			expect(response.status, rejectedOrigin).toBe(403);
		}
	});

	it('requires the isolated Fantasy Playtime secret binding', async () => {
		const response = await fetchFantasy(postRequest(validPayload(), { origin }), {
			...fantasyEnv,
			TURNSTILE_SECRET: undefined,
			TURNSTILE_SECRET_KEY: 'wrong-product-secret',
		});

		expect(response.status).toBe(500);
	});

	it('rejects a verified token with the wrong hostname or action', async () => {
		for (const turnstile of [
			{ action: 'login', hostname: 'fantasyplaytime.com' },
			{ action: 'contact', hostname: 'charlieyaris.com' },
		]) {
			mockOutboundFetch({ turnstileAction: turnstile.action, turnstileHostname: turnstile.hostname });
			const response = await fetchFantasy(postRequest(validPayload(), { origin }));

			expect(response.status).toBe(403);
			vi.unstubAllGlobals();
		}
	});

	it('sends Fantasy Playtime-branded mail with the submitter as Reply-To', async () => {
		const calls = mockOutboundFetch({ turnstileAction: 'contact', turnstileHostname: 'fantasyplaytime.com' });
		const response = await fetchFantasy(postRequest(validPayload(), { origin }));
		const [contactEmail, confirmationEmail] = calls
			.filter((call) => call.url.includes('api.resend.com'))
			.map((call) => JSON.parse(call.init.body));

		expect(response.status).toBe(200);
		expect(contactEmail.from).toBe(fantasyEnv.CONTACT_FROM_EMAIL);
		expect(contactEmail.reply_to).toBe('ada@example.com');
		expect(contactEmail.subject).toBe('Fantasy Playtime contact: Hello');
		expect(contactEmail.text).toContain('New Fantasy Playtime contact');
		expect(confirmationEmail.text).toContain('Fantasy Playtime');
		expect(confirmationEmail.text).toContain('https://fantasyplaytime.com');
	});
});
