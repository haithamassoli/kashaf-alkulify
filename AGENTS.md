## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Code style

Biome (via the Ultracite preset) is the single formatter and linter. Run
`npm run format` to fix, `npm run lint` to check, `npm run check` to also
type-check `.astro` files. A lefthook pre-commit hook formats staged files
automatically, so do not hand-format.

Full rule rationale: `node_modules/ultracite/skills/ultracite/references/code-standards.md`.

Rules that matter day to day:

- No `any`, no non-null `!`, no unchecked casts. Model the type or narrow it.
- No `console.log` or `debugger` in committed code.
- Prefer `const`, arrow functions, `for...of`, optional chaining, template literals.
- Early return over nested `if`. No `else` after `return`.
- Every `<img>` needs `alt`; every interactive element needs an accessible name and keyboard handler.
- No dead code: unused imports, variables, and parameters are errors.
- Astro components and layouts are `PascalCase.astro`; everything else is kebab-case.
- Style with Tailwind utilities in `class`. Reach for a `<style>` block only when a utility cannot express it.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
