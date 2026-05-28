# ADR-0010: GraalVM Polyglot Sandbox for Policy Execution

**Status**: Accepted (2026-05-29, R21 audit)
**Supersedes**: implicit `allowAllAccess(true)` posture in TrufflePolicyRuntime

## Context

Aster policy code is **tenant-supplied**. A policy author writes CNL, the
compiler emits Core IR JSON, and aster-api's `TrufflePolicyRuntime` evaluates
it through a GraalVM Polyglot Context pool.

Until R21, the runtime built every Context with:

```java
Context.newBuilder("aster")
    .engine(sharedEngine)
    .allowAllAccess(true)   // ← problem
    .build();
```

`allowAllAccess(true)` flips the following capabilities on:

- Host class lookup (`Java.type("java.lang.Runtime")` from inside Aster code)
- Filesystem IO (read any file the JVM can read)
- Native interop (`dlopen`, native calls)
- Process creation (`Runtime.exec`)
- Polyglot bindings (cross-context state sharing)
- Thread creation

Policy code originates from external/customer input. With `allowAllAccess(true)`
this path is functionally **RCE equivalence**. The audit (R21) flagged this as
the top remaining security gap.

Sibling path `DynamicCnlExecutor` (used by the validation REST endpoint) already
used `HostAccess.EXPLICIT` + `IOAccess.NONE`. R21 brings the production execution
path to the same posture.

## Decision

The Polyglot Context built by `TrufflePolicyRuntime` MUST configure:

| Capability | Setting | Why |
|---|---|---|
| `allowHostAccess` | `HostAccess.EXPLICIT` | Only `@HostAccess.Export` methods reachable. Truffle DSL nodes and `Builtins` table are annotated; nothing else is. |
| `allowIO` | `IOAccess.NONE` | Policies must not read or write files. |
| `allowNativeAccess` | `false` | No `dlopen`. |
| `allowHostClassLookup` | predicate returning `false` for every name | Blocks `Java.type(...)`. |
| `allowPolyglotAccess` | `PolyglotAccess.NONE` | Contexts in the pool are isolated; no shared bindings. |
| `allowCreateProcess` | `false` | No `Runtime.exec` equivalent. |
| `allowCreateThread` | default (false) | Policies shouldn't spawn threads. |

Implementation lives in
`aster-api/src/main/java/io/aster/policy/runtime/TrufflePolicyRuntime.java`.

## Consequences

### Positive

- Tenant-supplied policy code can no longer reach host JVM internals, the
  filesystem, the network, or native libraries.
- The production execution path is now consistent with the validation path
  (`DynamicCnlExecutor`).
- Defense-in-depth on top of input validation + AST canonicalization.

### Negative

- Any future builtin that relies on host classes or IO must be added to the
  `Builtins` table behind an `@HostAccess.Export` method — there is no
  back-channel.
- Adding such a builtin requires a deliberate code review touching this ADR.

### Verification

- `./gradlew test`: full suite passes (2m 30s) — no regression. Policies that
  legitimately call exported builtins (string ops, math, date) keep working.
- Negative test path: any policy attempting `Java.type(...)` or
  `import java.io.*` now fails at Context creation via predicate or at call
  site via classpath lookup denial.

### Developer CLI exception

`aster-lang-truffle/src/main/java/aster/truffle/Runner.java` is the **developer
CLI** entry (`java -cp ... aster.truffle.Runner foo.aster`). It keeps
`allowAllAccess(true)` because the operator explicitly invoked it on their
workstation against a local file they trust. The CLI is not on the production
request path. The comment in `Runner.java` cross-references this ADR.

## Future Work

- ADR-0011 (TBD): time/CPU bounds via `ResourceLimits.newBuilder().statementLimit()`
- Per-tenant Context limits (currently pool is process-global)
- Audit log entry on any Context-build failure (defense observability)
