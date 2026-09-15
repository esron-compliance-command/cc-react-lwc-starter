# cc-react-lwc-starter

A small, complete, **runnable** version of the architecture the Compliance Command UI/UX
modernization is built on: a React + TypeScript grid, bundled with esbuild, hosted inside an LWC,
backed by one Apex controller that is generic over the object.

It exists so that on 21 September you are not seeing this pattern for the first time.

Deploy it to your own free Developer org, open the page, sort a column, and then read the four files
that made that happen. Roughly twenty minutes end to end. Everything here is written fresh and
generic — no customer data, no package internals.

**The bar this repo exists to help you clear is in
[`docs/Readiness-Standard.pdf`](docs/Readiness-Standard.pdf)** — what every developer is expected to
be able to do on Day 1, plus six tasks against this repo that demonstrate it. Start there.
[`docs/Six-Day-Runway.pdf`](docs/Six-Day-Runway.pdf) is an optional day-by-day route to the same
place, for anyone who would rather not design their own.

---

## Get it running

```bash
git clone https://github.com/esron-compliance-command/cc-react-lwc-starter.git
cd cc-react-lwc-starter

npm install                      # sfdx-lwc-jest for the host tests
npm --prefix react-src install   # React, TypeScript, esbuild, vitest

npm run build                    # React -> one static resource
sf org login web --alias starter --set-default
npm run deploy                   # Apex, CMDT, LWC and the bundle
npm run test:apex                # Apex tests in the org -- 12 of them, all green
```

Then add **React Grid Host** to a Lightning app page (or an Experience Builder page) and set
*Object API Name* to `Account`.

> **npm 12 blocks install scripts.** If `npm run build` reports a missing esbuild binary, run
> `npm --prefix react-src install-scripts approve esbuild`. On npm 10 and 11 this does not arise.

---

## The four files that are the point

Read them in this order. Everything else in the repo is scaffolding around them.

| File | What it teaches |
| --- | --- |
| [`react-src/src/index.tsx`](react-src/src/index.tsx) | The mount contract: `configure`, `mount`, `unmount`, and nothing else. |
| [`react-src/src/services/bridge.ts`](react-src/src/services/bridge.ts) | The bridge — the one module that touches the global, which is what makes the whole app testable. |
| [`force-app/main/default/lwc/reactGridHost/reactGridHost.js`](force-app/main/default/lwc/reactGridHost/reactGridHost.js) | The host: loads the bundle, injects Apex, mounts, unmounts. No grid logic at all. |
| [`force-app/main/default/classes/StarterListController.cls`](force-app/main/default/classes/StarterListController.cls) | One controller, generic over the object, `USER_MODE`, config-driven columns. |

---

## Why React cannot just call Apex

This is the question to be able to answer without notes.

`import fetchList from '@salesforce/apex/Foo.bar'` is resolved by the **LWC compiler**, at build
time, inside an LWC module graph. Our React code is compiled by **esbuild**, outside that graph.
That import does not exist for it and never will.

So the LWC does the importing and hands React a plain object of promise-returning functions:

```js
// in the LWC — it can import Apex
ReactGrid.configure({
    fetchList: (request) => fetchList({ requestJson: JSON.stringify(request) }).then(JSON.parse),
    locale: USER_LOCALE,
    timeZone: USER_TIME_ZONE
});
ReactGrid.mount(this.mountElement, { objectApiName: this.objectApiName });
```

```ts
// in React — it has no idea Salesforce exists
const envelope = await getBridge().fetchList(request);
```

Three consequences worth internalising:

1. **`configure` before `mount`, always.** Mounting first gives you a `BridgeNotReadyError`, which is
   a host bug, not a network failure. The host test asserts the ordering.
2. **The bridge is the test seam.** `RecordTable.test.tsx` swaps in a fake bridge and exercises
   sorting, debounced search, empty states and error handling in under a second — no network, no
   org, no mocking framework.
3. **The React side can be rewritten** without opening a single file under `force-app`, as long as
   those three functions keep their shape.

---

## Things that are not obvious until they cost you a day

**`lwc:dom="manual"` is load-bearing.** Without it, LWC owns the subtree and React's writes are
reverted or blocked under synthetic shadow DOM.

**IIFE, not ESM.** `loadScript` injects a plain `<script>` tag. An ES module build never executes and
your global is silently `undefined`.

**No CDN.** Experience Cloud pages can be public or served to users behind a corporate proxy. React
and ReactDOM ship inside the bundle — which costs about 144 KB minified, all of it, for the whole
grid.

**`renderedCallback` fires on every render.** Guard it, and set the guard *before* the first `await`.

**Always `unmount`.** A React root left attached to a detached node is a leak that shows up as a slow
site after ten navigations, long after anyone remembers why.

**StrictMode runs effects twice in development, on purpose.** That is not a bug to suppress: it is
telling you an effect is missing its cleanup. See `useRecordList.ts`, which tracks a request sequence
so a slow response that lands after a newer one is discarded rather than allowed to overwrite the
screen.

**Lightning Web Security sanitizes the DOM.** Inline `<svg>` in a community flashes and then
disappears. Ship icons as `<img>` from a static resource.

**Deployed is not visible.** The component must be placed on the page in Experience Builder, and a
new `@AuraEnabled` class must be in the community permission set, or customers see nothing while your
deploy reports complete success. On an LWR site you must also run `sf community publish` — skip it
and the site keeps serving the previous bundle.

**Three things this repo only learned by deploying.** All three passed every local check first —
typecheck clean, 9 vitest green, 4 jest green — and all three failed the moment a real org saw them.
That gap is the reason this starter exists.

1. **`sort` is a reserved identifier in Apex.** A class member called `sort` does not compile
   (`Identifier name is reserved: sort`). The wire contract is therefore `sortState` on *both*
   sides — a platform constraint reaching all the way out into the JSON.
2. **A custom-metadata record with `xmlns:xsi` declared on each `<value>`** instead of on the root
   `<CustomMetadata>` element fails with `UNKNOWN_EXCEPTION` and **zero component failures**. No
   line number, no file, nothing to grep. Declare the namespaces once, on the root.
3. **`**/__tests__/**` must be in `.forceignore`**, or the deploy tries to compile your Jest test as
   part of the LWC bundle and fails with `LWC1702: Invalid LWC imported identifier "createElement"`.

Note what two of those have in common: `UNKNOWN_EXCEPTION` with no component detail. When you see
that, stop reading your code and start bisecting the deploy by folder — objects first, then classes,
then custom metadata, then LWC. The error text will not narrow it for you.

**Never hardcode a namespace.** The real package prefix is one thing in production and another in QA.
Serialize an SObject straight to the client and every custom field arrives as `cocmd__Status__c` in
one org and `coqa__Status__c` in another. `StarterListController.toClientRows` is the firewall: the
client always sees `Status__c`.

---

## Generic over the object — the part to actually absorb

`Account` and `Contact` are both rendered by the **same** React bundle, the **same** LWC, and the
**same** Apex class. The only difference between them is eight `Starter_Grid_Column__mdt` records in
[`force-app/main/default/customMetadata`](force-app/main/default/customMetadata).

Adding a third object is a configuration change. Try it: copy the four `Contact_*` records, point
them at `Opportunity`, deploy, and set the property on the page.

Every time you are tempted to write `FooListController`, ask what configuration would have let the
existing class handle `Foo` already.

That is also what makes the dynamic SOQL safe. Field names are interpolated into the query **only**
from configuration, never from the request — a client asking to sort by
`Name DESC, (SELECT Id FROM Contacts)` is ignored, and there is a test that proves it. The search
*term* is bound, and `%` and `_` are escaped so a user searching for "50%" finds the company called
"50% Holdings" rather than everything beginning with 50.

---

## Security, in the three lines that matter

```apex
public with sharing class StarterListController {          // record sharing applies
    Database.queryWithBinds(soql, binds, AccessLevel.USER_MODE);   // CRUD + FLS enforced, throws
    Database.countQueryWithBinds(countSoql, filterBinds, AccessLevel.USER_MODE);
```

`USER_MODE` enforces **CRUD and FLS**. It does **not** enforce record sharing — that is
`with sharing`, and they fail in different ways. A `with sharing` class querying a Private object
returns a community user zero rows no matter what access level you pass; a missing field permission
throws. Knowing which of the two you are looking at is most of the diagnosis.

Note also that `WITH SECURITY_ENFORCED` cannot be combined with an explicit access level, and is not
allowed on `COUNT()` at all. `USER_MODE` covers both queries, which is why it is used here.

---

## The three test runners, and why there are three

```bash
npm run typecheck    # tsc --noEmit, strict, zero `any`
npm run test:react   # vitest + Testing Library — 9 tests, no network
npm run test:lwc     # sfdx-lwc-jest — 4 tests on the host
npm run test:apex    # Apex tests in the org
npm --prefix e2e test  # Playwright against a real org
```

They do not overlap by accident:

- **Vitest** tests grid *behaviour* against a fake bridge. Fast enough to run on save.
- **Jest** tests the *host* — that it configures before mounting, serializes correctly, and unmounts.
  Four tests, because the host should never grow enough logic to need more.
- **Apex tests** (12, verified green in a real org) assert *behaviour*, not coverage: paging, an injected sort field, the LIKE escaping,
  the offset ceiling, and a restricted user under `System.runAs`. A test that runs a method and
  asserts it did not throw is coverage theatre — it passes forever, including after you break the
  feature.
- **Playwright** is the only one that proves the whole stack works in a real org. On this team every
  fix ships with an e2e test in the same pull request, so learn the API before it is urgent.
  `e2e/tests/grid.spec.ts` ends with a list of locator traps that have already cost this team hours.

---

## Exercises, in increasing order of usefulness

1. Add `Opportunity` as a third list. Configuration only — no Apex, no React.
2. Add a **Type** column to Accounts and watch it appear. Then remove that field from your
   permission set and watch the controller refuse rather than return blanks.
3. Add a column-visibility toggle in React. Notice it needs no Apex change at all.
4. Add a server-side **filter** (say, Industry): extend `ListRequest` in `types.ts` *and*
   `StarterListController`, in one commit. Feel where the contract lives.
5. Make the table keyboard-navigable, then check it with a screen reader. Our users include people
   who never touch a mouse.
6. Break it on purpose: mount before configure, drop the `renderedCallback` guard, remove the
   cleanup in `useRecordList`. Watch what each failure looks like from the outside — recognising
   these three shapes is worth more than reading about them.

---

## What this starter deliberately leaves out

No router, no Redux, no CSS framework, no Next.js, no class components, no CDN. The real grid does
not use them either. If you are learning one of those this week, you are spending the week on
something this project will not ask you for.
