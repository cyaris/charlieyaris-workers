import { createContactWorker } from './contact.js';

export default createContactWorker({
	allowedOrigins: [
		'https://charlieyaris.com',
		'https://www.charlieyaris.com',
		'https://cyaris.github.io',
		'http://localhost:4000',
		'http://127.0.0.1:4000',
	],
	allowedTurnstileHostnames: ['charlieyaris.com', 'www.charlieyaris.com', 'localhost', '127.0.0.1'],
	confirmationIntroduction: 'Thanks for reaching out! I received your message and will get back to you as soon as I can.',
	confirmationSubject: 'Thanks for reaching out!',
	notificationHeading: 'New website contact',
	notificationSubjectPrefix: 'Website contact',
	primaryOrigin: 'https://charlieyaris.com',
	productName: 'Charlie Yaris',
	signatureName: 'Charlie Yaris',
	signatureUrl: 'https://charlieyaris.com',
	signatureUrlLabel: 'charlieyaris.com',
	turnstileSecretBinding: 'TURNSTILE_SECRET_KEY',
});
