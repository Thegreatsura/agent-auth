# Changelog

All notable changes to `@better-auth/agent-auth` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.6.0

### Fixed

- **Scope the global `before`-hook matcher to agent-auth's own endpoints.**
  The hook is registered across the entire auth instance, but its matcher
  previously intercepted **any** request carrying a 3-part `Authorization: Bearer`
  JWT on every path (except `/agent/register` and `/agent/claim`). When agent-auth
  was used alongside other Bearer-based plugins or core Better Auth routes, it
  would grab their tokens and reject them with an `AgentAuth` challenge before the
  intended handler ever ran — surfacing as a `401` with correct credentials and no
  log from the real owner. The matcher now only runs on agent-auth's own paths
  (`/agent/*`, `/capability/*`, `/host/*`), so every plugin validates its own
  tokens. Custom endpoints should continue to authenticate agents via
  `verifyAgentRequest` / `auth.api.getAgentSession`.
