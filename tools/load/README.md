# @xeno/load

Placeholder package for the load + chaos harness.

A later prompt fills this in: push N communications through
`launch -> channel-stub -> receipts` and assert the core correctness invariants:

- receipts are idempotent on `idempotencyKey`
- `Communication.status` is a monotonic projection over `CommunicationEvent`
- denormalized campaign counters equal the event aggregates

For now it is an empty, typechecking stub so the workspace stays green.

Run (once implemented):

```sh
pnpm load
```
