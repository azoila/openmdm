# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of OpenMDM seriously. If you believe you have found a security vulnerability, please report it to us as described below.

**Please do not report security vulnerabilities through public GitHub issues.**

### How to Report

Send an email to [security@openmdm.dev](mailto:security@openmdm.dev) with:

1. **Description** of the vulnerability
2. **Steps to reproduce** the issue
3. **Potential impact** of the vulnerability
4. **Suggested fix** (if you have one)

### What to Expect

- **Acknowledgment**: We will acknowledge receipt of your report within 48 hours.
- **Assessment**: We will investigate and assess the vulnerability within 7 days.
- **Updates**: We will keep you informed of our progress.
- **Resolution**: We aim to resolve critical vulnerabilities within 30 days.
- **Credit**: We will credit you in our release notes (unless you prefer to remain anonymous).

### Disclosure Policy

- We follow a coordinated disclosure process.
- We ask that you do not publicly disclose the vulnerability until we have released a fix.
- We will work with you to determine an appropriate disclosure timeline.

## Security Best Practices

When using OpenMDM, we recommend the following security practices:

### Environment Variables

Never commit sensitive data to version control:

```bash
# .env (never commit this file)
DEVICE_HMAC_SECRET=your-secret-key
JWT_SECRET=your-jwt-secret
WEBHOOK_SECRET=your-webhook-secret
FCM_CREDENTIALS=path/to/credentials.json
DATABASE_URL=postgresql://...
```

### HMAC Device Authentication

Always configure device authentication with a strong secret:

```typescript
const mdm = createMDM({
  enrollment: {
    deviceSecret: process.env.DEVICE_HMAC_SECRET, // Use a cryptographically random secret
    autoEnroll: false, // Consider requiring approval for new devices
  },
});
```

### Webhook Signature Verification

Always verify webhook signatures in your handlers:

```typescript
import { verifyWebhookSignature } from '@openmdm/core';

app.post('/webhooks/mdm', (req, res) => {
  const signature = req.headers['x-openmdm-signature'];
  const isValid = verifyWebhookSignature(
    JSON.stringify(req.body),
    signature,
    process.env.WEBHOOK_SECRET
  );

  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }

  // Process webhook...
});
```

### Database Security

- Use parameterized queries (the adapters handle this automatically)
- Limit database user permissions
- Enable SSL for database connections
- Regularly backup your database

### Network Security

- Always use HTTPS in production
- Configure proper CORS policies
- Use a reverse proxy (nginx, Cloudflare, etc.)
- Implement rate limiting

### Push Notification Security

- Protect FCM service account credentials
- Use data-only messages for sensitive commands
- Validate push tokens before sending

## Security Features

OpenMDM includes several built-in security features:

### HMAC Authentication

All device enrollments are verified using HMAC-SHA256 signatures:

```typescript
// Device signs enrollment request
const signature = hmacSha256(
  `${identifier}:${timestamp}`,
  sharedSecret
);
```

### JWT Device Tokens

Enrolled devices receive JWT tokens for API authentication:

- Tokens are signed with HS256
- Configurable expiration (default: 1 year)
- Tokens can be revoked by unenrolling the device

### Webhook Signatures

All outbound webhooks are signed with HMAC-SHA256:

```
X-OpenMDM-Signature: sha256=abc123...
```

### Command Verification

Commands are tracked with unique IDs and timestamps to prevent replay attacks.

## Vulnerability Disclosure Hall of Fame

We would like to thank the following security researchers for responsibly disclosing vulnerabilities:

*No vulnerabilities have been reported yet.*

---

Thank you for helping keep OpenMDM and its users safe!
