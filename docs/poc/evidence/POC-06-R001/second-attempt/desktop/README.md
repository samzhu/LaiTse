# T18 process restart smoke

Operational result: failed
Dynamic restoration: not-restored; server records are process-memory only
Product conclusion: NO_GO_DURABILITY_UNRESOLVED

Three isolated Firefox profiles stayed open across two script-owned server processes. The old bearer proofs were retried against a new process and required explicit normal UI join to obtain new participant IDs. The report retains only allowlisted control metadata, UUIDs, counters, approved error codes, and rendered-media observations; it contains no resume token, password, chat text, or raw media.

A successful manual rejoin is operational rebuild evidence. Process-memory members, grants, live password, feedback/history, and counters were not restored; their loss is not accepted as product behavior. This is not a full T18/POC-06 pass, Cloud Run result, or deployment result.

Screenshots: before-restart-media-active.png, server-down-client-state.png, after-manual-rejoin-before-republish.png
Failure: Expected values to be strictly equal:
+ actual - expected

+ undefined
- true
