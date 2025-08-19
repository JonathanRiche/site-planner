# Site Planner

An intelligent website analysis tool that scans any site URL to determine optimal tagging and analytics strategies for LYTX.io integration. Additionally generates comprehensive keyword research and marketing strategies to drive growth and engagement.

## Features

- **Site Analysis**: Automatically scans websites to identify optimal placement for LYTX.io tags and analytics
- **Analytics Strategy**: Provides data-driven recommendations for tracking implementation
- **Keyword Research**: Generates targeted keyword strategies for improved SEO and marketing
- **Growth Marketing**: Delivers actionable marketing strategies to scale your web presence
- **LYTX.io Integration**: Seamless integration recommendations for the LYTX.io analytics platform

## Tech Stack

- **Runtime**: [Bun](https://bun.com) - Fast all-in-one JavaScript runtime
- **Framework**: [RedwoodSDK](https://github.com/redwoodjs/redwood) - Full-stack web framework for Cloudflare
- **Language**: TypeScript for type-safe development
- **Deployment**: Cloudflare Workers

## Installation

### Prerequisites

Ensure you have [Bun](https://bun.sh) installed on your system:

```bash
curl -fsSL https://bun.sh/install | bash
```

### Setup

1. Clone the repository:
```bash
git clone <repository-url>
cd site_planner
```

2. Install dependencies:
```bash
bun install
```

3. Generate Cloudflare types (optional):
```bash
bun run cf-types
```

## Development

### Development Server

Start the development server with hot reload:

```bash
bun run dev
```

### Initialize Development Environment

Set up the development environment:

```bash
bun run dev:init
```

### Build

Build the project for production:

```bash
bun run build
```

### Clean Build Cache

Clean Vite build cache:

```bash
bun run clean
```

### Deployment

Deploy to Cloudflare Workers:

```bash
bun run release
```

## Project Structure

```
site_planner/
├── src/
│   ├── Document.tsx        # Root document template
│   ├── index.css          # Global styles
│   └── worker.tsx         # Main worker entry point
├── worker.tsx             # Cloudflare Worker configuration
├── wrangler.jsonc         # Cloudflare deployment config
├── vite.config.ts         # Vite build configuration
└── tsconfig.json          # TypeScript configuration
```

## RedwoodSDK Integration

This project uses RedwoodSDK for building full-stack applications on Cloudflare Workers. Key concepts:

- **Server Components**: Default rendering on the server
- **Client Components**: Use `"use client"` directive for interactivity
- **Server Functions**: Use `"use server"` directive for server-side operations
- **Middleware**: Request/response processing pipeline
- **Interruptors**: Route-level middleware for authentication, validation, etc.

## Usage

1. Start the development server
2. Navigate to the application in your browser
3. Enter a website URL to analyze
4. Receive comprehensive analysis including:
   - LYTX.io integration recommendations
   - Analytics placement strategies  
   - Keyword research insights
   - Marketing growth strategies

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request
