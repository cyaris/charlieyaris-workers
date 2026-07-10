const ALLOWED_ORIGINS = new Set([
  "https://charlieyaris.com",
  "https://www.charlieyaris.com",
  "https://cyaris.github.io",
]);

const jsonResponse = (body, status, origin = "") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
        ? origin
        : "https://charlieyaris.com",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    },
  });

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

async function verifyTurnstile(token, ip, secretKey) {
  const formData = new FormData();

  formData.append("secret", secretKey);
  formData.append("response", token);

  if (ip) {
    formData.append("remoteip", ip);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: formData,
    },
  );

  if (!response.ok) {
    return {
      success: false,
      errorCodes: ["siteverify-request-failed"],
    };
  }

  const result = await response.json();

  return {
    success: result.success === true,
    hostname: result.hostname,
    errorCodes: result["error-codes"] ?? [],
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";

    if (request.method === "OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) {
        return new Response(null, {
          status: 403,
          headers: {
            Vary: "Origin",
          },
        });
      }

      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        },
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Method not allowed." },
        405,
        origin,
      );
    }

    if (!ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse({ error: "Origin not allowed." }, 403, origin);
    }

    let payload;

    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid request body." }, 400, origin);
    }

    const {
      name = "",
      email = "",
      subject = "",
      message = "",
      website = "",
      turnstileToken = "",
    } = payload;

    // Honeypot field. Humans should never fill this in.
    if (website) {
      return jsonResponse({ success: true }, 200, origin);
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();

    if (
      !trimmedName ||
      !trimmedEmail ||
      !trimmedSubject ||
      !trimmedMessage
    ) {
      return jsonResponse(
        { error: "Please complete every required field." },
        400,
        origin,
      );
    }

    if (!isValidEmail(trimmedEmail)) {
      return jsonResponse(
        { error: "Please enter a valid email address." },
        400,
        origin,
      );
    }

    if (
      trimmedName.length > 100 ||
      trimmedEmail.length > 254 ||
      trimmedSubject.length > 150 ||
      trimmedMessage.length > 5000
    ) {
      return jsonResponse(
        { error: "One or more fields are too long." },
        400,
        origin,
      );
    }

    if (!turnstileToken) {
      return jsonResponse(
        { error: "Spam verification is required." },
        400,
        origin,
      );
    }

    const ip = request.headers.get("CF-Connecting-IP") ?? "";

    const turnstile = await verifyTurnstile(
      turnstileToken,
      ip,
      env.TURNSTILE_SECRET_KEY,
    );

    if (
      !turnstile.success ||
      !["charlieyaris.com", "www.charlieyaris.com"].includes(
        turnstile.hostname,
      )
    ) {
      return jsonResponse(
        { error: "Spam verification failed. Please try again." },
        403,
        origin,
      );
    }

    const safeName = escapeHtml(trimmedName);
    const safeEmail = escapeHtml(trimmedEmail);
    const safeSubject = escapeHtml(trimmedSubject);
    const safeMessage = escapeHtml(trimmedMessage).replaceAll(
      "\n",
      "<br>",
    );

    const resendResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.CONTACT_FROM_EMAIL,
          to: [env.CONTACT_TO_EMAIL],
          reply_to: trimmedEmail,
          subject: `Website contact: ${trimmedSubject}`,
          text: [
            `Name: ${trimmedName}`,
            `Email: ${trimmedEmail}`,
            `Subject: ${trimmedSubject}`,
            "",
            trimmedMessage,
          ].join("\n"),
          html: `
            <h2>New website contact</h2>

            <p><strong>Name:</strong> ${safeName}</p>
            <p><strong>Email:</strong> ${safeEmail}</p>
            <p><strong>Subject:</strong> ${safeSubject}</p>

            <hr>

            <p>${safeMessage}</p>
          `,
        }),
      },
    );

    if (!resendResponse.ok) {
      const resendError = await resendResponse.text();

      console.error("Resend error:", resendError);

      return jsonResponse(
        {
          error:
            "The message could not be sent. Please try again later.",
        },
        502,
        origin,
      );
    }

    return jsonResponse(
      {
        success: true,
        message: "Your message has been sent.",
      },
      200,
      origin,
    );
  },
};