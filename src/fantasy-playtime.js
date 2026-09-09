import { createContactWorker } from './contact.js';

export default createContactWorker({
	allowedOrigins: ['https://fantasyplaytime.com'],
	allowedTurnstileHostnames: ['fantasyplaytime.com'],
	confirmationIntroduction: 'Thanks for contacting Fantasy Playtime! We received your message and will get back to you as soon as we can.',
	confirmationSubject: 'Thanks for contacting Fantasy Playtime!',
	developmentOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
	developmentTurnstileHostnames: ['127.0.0.1', 'localhost'],
	notificationHeading: 'New Fantasy Playtime contact',
	notificationSubjectPrefix: 'Fantasy Playtime contact',
	primaryOrigin: 'https://fantasyplaytime.com',
	productName: 'Fantasy Playtime',
	signatureName: 'Fantasy Playtime',
	signatureUrl: 'https://fantasyplaytime.com',
	signatureUrlLabel: 'fantasyplaytime.com',
	turnstileAction: 'contact',
	turnstileSecretBinding: 'TURNSTILE_SECRET',
});
