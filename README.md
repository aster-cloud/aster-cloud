# Aster Cloud

Commercial SaaS platform for Aster policy management.

🌐 **Live at**: [aster-lang.cloud](https://aster-lang.cloud)

## Overview

Aster Cloud is the commercial platform for managing business policies with built-in PII protection and compliance monitoring. It complements the open-source [Aster Lang](https://aster-lang.dev) project.

## Features

- **Dashboard** - Manage policies, view analytics, track usage
- **PII Protection** - Automatic detection and protection of sensitive data
- **Compliance Reports** - Generate GDPR-ready compliance reports
- **Team Collaboration** - Role-based access control, shared policy libraries
- **API Access** - Integrate policies into your applications

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Styling**: Tailwind CSS
- **Auth**: NextAuth.js
- **Database**: PostgreSQL (Prisma ORM)
- **Payments**: Stripe
- **Email**: Resend
- **Analytics**: Mixpanel
- **Deployment**: Vercel

## Getting Started

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env.local

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

See `.env.example` for all required environment variables.

## Project Structure

```
src/
├── app/
│   ├── (auth)/           # Login, signup, password reset
│   ├── (dashboard)/      # Protected dashboard pages
│   ├── (marketing)/      # Public landing pages
│   └── api/              # API routes
├── components/           # Reusable UI components
├── lib/                  # Utility libraries (Stripe, Resend, etc.)
├── hooks/                # Custom React hooks
└── types/                # TypeScript type definitions
```

## Related Projects

- [aster-lang](https://github.com/aster-cloud/aster-lang) - Core language compiler and runtime
- [aster-dev](https://github.com/aster-cloud/aster-dev) - Open source portal (aster-lang.dev)

## License

Proprietary - All rights reserved.
