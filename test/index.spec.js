import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src';

const ALLOWED_ORIGIN = 'https://charlieyaris.com';

const testEnv = {
	RESEND_API_KEY: 'test-resend-key',
	TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
	CONTACT_FROM_EMAIL: 'Website Contact <contact@mail.charlieyaris.com>',
	CONTACT_TO_EMAIL: 'charlieyaris@gmail.com',
};

const validPayload = () => ({
	name: '  Ada Lovelace  ',
	email: '  ada@example.com  ',
	subject: '  Hello  ',
	message: '  A message with real content.  ',
	turnstileToken: '  a-turnstile-token  ',
});

const postRequest = (body, { origin = ALLOWED_ORIGIN, headers = {} } = {}) =>
	new Request('https://contact-form-worker.example/', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
		body: JSON.stringify(body),
	});

const fetchHandler = async (request, env = testEnv) => {
	const ctx = createExecutionContext();
	const response = await worker.fetch(request, env, ctx);
	await waitOnExecutionContext(ctx);

	return response;
};

const mockOutboundFetch = ({ turnstileSuccess = true, resendOk = true, confirmationOk = true } = {}) => {
	const calls = [];

	vi.stubGlobal(
		'fetch',
		vi.fn(async (url, init) => {
			calls.push({ url: String(url), init });

			if (String(url).includes('challenges.cloudflare.com')) {
				return new Response(
					JSON.stringify({
						success: turnstileSuccess,
						hostname: turnstileSuccess ? 'charlieyaris.com' : '',
						'error-codes': turnstileSuccess ? [] : ['invalid-input-response'],
					}),
					{ status: 200 },
				);
			}

			const resendCallCount = calls.filter((call) => call.url.includes('api.resend.com')).length;
			const ok = resendCallCount > 1 ? confirmationOk : resendOk;

			return new Response(JSON.stringify({ id: 'email-id' }), { status: ok ? 200 : 502 });
		}),
	);

	return calls;
};

const requiredFields = ['name', 'email', 'subject', 'message', 'turnstileToken'];
const invalidFieldValues = [
	{ label: 'null', value: null },
	{ label: 'number', value: 42 },
	{ label: 'array', value: ['array'] },
	{ label: 'object', value: { object: true } },
];
const invalidFieldCases = requiredFields.flatMap((field) => invalidFieldValues.map(({ label, value }) => ({ field, label, value })));

describe('contact form worker', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('handles a CORS preflight request from an allowed origin', async () => {
		const request = new Request('https://contact-form-worker.example/', { method: 'OPTIONS', headers: { Origin: ALLOWED_ORIGIN } });
		const response = await fetchHandler(request);

		expect(response.status).toBe(204);
		expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
	});

	it('rejects a CORS preflight request from a disallowed origin', async () => {
		const request = new Request('https://contact-form-worker.example/', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
		const response = await fetchHandler(request);

		expect(response.status).toBe(403);
	});

	it('rejects non-POST methods', async () => {
		const request = new Request('https://contact-form-worker.example/', { method: 'GET', headers: { Origin: ALLOWED_ORIGIN } });
		const response = await fetchHandler(request);

		expect(response.status).toBe(405);
	});

	it('rejects requests from a disallowed origin', async () => {
		const response = await fetchHandler(postRequest(validPayload(), { origin: 'https://evil.example' }));

		expect(response.status).toBe(403);
	});

	it('returns 500 when required bindings are missing', async () => {
		const response = await fetchHandler(postRequest(validPayload()), { ...testEnv, RESEND_API_KEY: undefined });

		expect(response.status).toBe(500);
	});

	it('rejects an invalid JSON body', async () => {
		const request = new Request('https://contact-form-worker.example/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: ALLOWED_ORIGIN },
			body: '{not valid json',
		});
		const response = await fetchHandler(request);

		expect(response.status).toBe(400);
	});

	it('silently accepts a honeypot submission without sending email', async () => {
		const calls = mockOutboundFetch();
		const response = await fetchHandler(postRequest({ ...validPayload(), website: 'https://spam.example' }));

		expect(response.status).toBe(200);
		expect(calls).toHaveLength(0);
	});

	describe('strict input contract', () => {
		it.each(invalidFieldCases)('rejects a $label value for $field', async ({ field, value }) => {
			const response = await fetchHandler(postRequest({ ...validPayload(), [field]: value }));

			expect(response.status).toBe(400);
		});
	});

	it('trims valid string field values before use', async () => {
		const calls = mockOutboundFetch();
		const response = await fetchHandler(postRequest(validPayload()));

		expect(response.status).toBe(200);

		const contactBody = JSON.parse(calls[1].init.body);

		expect(contactBody.reply_to).toBe('ada@example.com');
		expect(contactBody.subject).toBe('Website contact: Hello');
	});

	it('rejects an invalid email address', async () => {
		const response = await fetchHandler(postRequest({ ...validPayload(), email: 'not-an-email' }));

		expect(response.status).toBe(400);
	});

	it('rejects fields that exceed the maximum length', async () => {
		const response = await fetchHandler(postRequest({ ...validPayload(), name: 'a'.repeat(101) }));

		expect(response.status).toBe(400);
	});

	it('rejects a blank turnstile token', async () => {
		const response = await fetchHandler(postRequest({ ...validPayload(), turnstileToken: '   ' }));

		expect(response.status).toBe(400);
	});

	it('rejects a failed turnstile verification', async () => {
		mockOutboundFetch({ turnstileSuccess: false });
		const response = await fetchHandler(postRequest(validPayload()));

		expect(response.status).toBe(403);
	});

	it('returns 502 when the contact email fails to send', async () => {
		mockOutboundFetch({ resendOk: false });
		const response = await fetchHandler(postRequest(validPayload()));

		expect(response.status).toBe(502);
	});

	it('succeeds even when the best-effort confirmation email fails', async () => {
		mockOutboundFetch({ confirmationOk: false });
		const response = await fetchHandler(postRequest(validPayload()));

		expect(response.status).toBe(200);
	});

	it('sends the contact email and a confirmation email on success', async () => {
		const calls = mockOutboundFetch();
		const response = await fetchHandler(postRequest(validPayload()));

		expect(response.status).toBe(200);
		expect(calls.filter((call) => call.url.includes('api.resend.com'))).toHaveLength(2);
	});
});
