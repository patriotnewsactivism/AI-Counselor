# Workspace

This is a Node.js/TypeScript project with pnpm as the package manager.

## Project Structure

- `lib/` - Main source code
- `scripts/` - Utility scripts
- `artifacts/` - Build artifacts or generated files
- `.agents/` - Agent configuration
- `.poolside/` - Poolside configuration

## Configuration

- `package.json` - Project dependencies and scripts
- `tsconfig.json` / `tsconfig.base.json` - TypeScript configuration
- `pnpm-workspace.yaml` - PNPM workspace configuration
- `vercel.json` - Vercel deployment configuration

## Database

- `ai-counselor-schema.sql` - SQL schema for AI counselor database

## Documentation

- `AGENTS.md` - Agent documentation
- `qwen.md` - Qwen-specific documentation

## Getting Started

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build project
pnpm build
```
