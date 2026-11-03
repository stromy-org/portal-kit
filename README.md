# @stromy/portal-kit

The evolving half of a Stromy portal shell: a static, data-free web app that signs a
person in and reads everything from an authorization gatekeeper. Shells are created from
the `portal-shell-template` Copier archetype and pin this package by tag:

```json
"@stromy/portal-kit": "github:stromy-org/portal-kit#v0.1.0"
```

The package ships TypeScript source; the shell's Vite/Astro build compiles it. Agent and
maintainer instructions are in [AGENTS.md](AGENTS.md); release history in
[CHANGELOG.md](CHANGELOG.md).

```bash
npm ci --ignore-scripts
npm run check   # typecheck + unit and component tests
npm run e2e     # browser tests on the demo shell, under the strict CSP
```
