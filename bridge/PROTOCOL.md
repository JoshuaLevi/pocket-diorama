# cartridge-diorama-bridge protocol v1

This document is the contract between the bridge running on a laptop and the client
running inside the lens. It is normative: if the code and this file disagree, the file is
the bug report.

Every JSON example below was captured from a live session against a real Pokemon Red
cartridge image. Nothing here is illustrative pseudocode.

---

## 1. Transport

| | |
|---|---|
| URL | `ws://<laptop-lan-ip>:8781` |
| Subprotocol | none — do not send `Sec-WebSocket-Protocol` |
| Extensions | none — `permessage-deflate` is not negotiated |
| Text frames | UTF-8 JSON, one message per frame |
| Binary frames | a 20 byte `PAR1` header followed by payload bytes |
| Max frame size | **65536 bytes in either direction** |

The bridge listens on `0.0.0.0` so the glasses can reach it; the browser UI is a separate
server on `127.0.0.1:8780` and is none of the lens's business.

`wss://` is not offered. This is a LAN provisioning tool for a one-time handover, and a
lens that needs `wss://` needs a certificate the user does not have. On Spectacles, `ws://`
requires Experimental APIs, which is expected: the bridge is a development and
first-run tool, not something a published lens depends on.

### 1.1 The one rule that will bite you

**Install your message handler once, when the socket opens. Never install one in reaction
to a message.**

Chunk frames can be parsed by your WebSocket stack in the same event loop turn as the
`rom.begin` that announced them. A client that waits for `rom.begin` and only then
subscribes to binary frames will silently miss chunk 0 and end up with a buffer full of
zeros that hashes to something plausible-looking and wrong. The bridge yields one event
loop turn after `rom.begin` to make this unlikely, but the guarantee you should write code
against is: *one handler, installed at connect time, that switches on message type.*

---

## 2. Shape of a conversation

```
lens                                bridge
  |------------- TCP + WS upgrade ---->|
  |<------------ hello ----------------|   always first, unsolicited
  |------------- pair ---------------->|
  |<------------ paired ---------------|
  |------------- rom.list ------------>|
  |<------------ rom.list.ok ----------|
  |------------- rom.get ------------->|
  |<------------ rom.begin ------------|
  |<------------ [binary chunk 0] -----|
  |<------------ [binary chunk 1] -----|
  |                  ...               |
  |<------------ rom.end --------------|   verify sha1, then bake
```

### Request correlation

Any message you send may carry an `id` (any string, up to 64 characters). The reply that
answers it carries the same `id`, **including error replies**. Messages the bridge sends on
its own initiative (`hello`, chunk frames, `rom.end`, `event`) carry no `id`.

Chunk frames and the closing `rom.end` are correlated by `transferId`, not by `id`.

---

## 3. Handshake

The bridge speaks first, before you send anything:

```json
{
  "type": "hello",
  "protocolVersion": 1,
  "server": { "name": "cartridge-diorama-bridge", "version": "1.0.0" },
  "sessionId": "39c3df13-0834-4572-90da-dd68802d0a03",
  "pairingRequired": true,
  "capabilities": {
    "maxFrameBytes": 65536,
    "chunkBytesDefault": 32768,
    "chunkBytesMaxBinary": 65516,
    "chunkBytesMaxBase64": 47000,
    "encodings": ["binary", "base64"],
    "chunkHeaderBytes": 20
  }
}
```

Read `capabilities` rather than hardcoding the numbers; refuse to continue if
`protocolVersion` is not one you understand.

---

## 4. Pairing

The bridge prints a six digit code in the terminal and shows it in its browser UI. Send it
before anything else. Until you do, every other message is answered with `E_NOT_PAIRED`.

```json
--> { "type": "pair", "id": "a1", "code": "246810",
      "client": { "name": "Pocket Diorama", "version": "0.1.0", "platform": "spectacles" } }

<-- { "type": "paired", "id": "a1", "pairedAt": "2026-09-03T21:36:08.483Z" }
```

`client` is optional and purely cosmetic: it is what the browser UI shows next to the
green dot. A wrong code returns `E_BAD_CODE`. Three wrong codes on one connection returns
`E_RATE_LIMIT` and the socket is closed with status 1008. A connection that has not paired
within 60 seconds is dropped.

When the bridge was started with `--no-pairing`, `hello.pairingRequired` is `false` and any
`pair` message succeeds regardless of the code. Send one anyway — it is how the UI learns
your name.

---

## 5. Listing ROMs

```json
--> { "type": "rom.list", "id": "a2" }

<-- {
  "type": "rom.list.ok",
  "id": "a2",
  "roms": [
    {
      "romId": "ea9bcae617fdf159b045185467ae58b2e4a48b9a",
      "game": "red",
      "label": "Pokemon Red (USA, Europe)",
      "filename": "Pokemon - Red Version (USA_ Europe).gb",
      "sizeBytes": 1048576,
      "sha1": "ea9bcae617fdf159b045185467ae58b2e4a48b9a",
      "crc32": "9f7fdd53",
      "cartridgeTitle": "POKEMON RED",
      "addedAt": "2026-09-03T21:36:06.987Z"
    }
  ]
}
```

`romId` is the SHA-1 and is stable forever. Cache it: on a later run you can ask for a
specific `romId` without listing first, and get `E_UNKNOWN_ROM` if the user removed it.

**Only verified cartridges are ever listed.** The bridge compares each file against three
canonical hashes:

| game | SHA-1 | bytes |
|---|---|---|
| red | `ea9bcae617fdf159b045185467ae58b2e4a48b9a` | 1048576 |
| blue | `d7037c83e1ae5b39bde3c30787637ba1d4c48ce2` | 1048576 |
| yellow | `cc7d03262ebfaf2f06772c1a480c7d9d5f4a38e1` | 1048576 |

Anything else stays in the user's library with a red verdict in the browser UI and is
never listed here, never sent, and answered with `E_ROM_UNVERIFIED` if asked for by id.
Decoding an unknown revision with Gen 1 symbol addresses produces garbage that looks like
data, which is worse than a refusal.

---

## 6. Fetching a ROM

```json
--> { "type": "rom.get", "id": "a3",
      "romId": "ea9bcae617fdf159b045185467ae58b2e4a48b9a",
      "encoding": "binary", "chunkBytes": 32768, "ackEvery": 0 }

<-- { "type": "rom.begin", "id": "a3", "transferId": 1,
      "romId": "ea9bcae617fdf159b045185467ae58b2e4a48b9a",
      "game": "red",
      "sha1": "ea9bcae617fdf159b045185467ae58b2e4a48b9a",
      "crc32": "9f7fdd53",
      "sizeBytes": 1048576,
      "chunkBytes": 32768, "chunkCount": 32,
      "encoding": "binary", "ackEvery": 0 }
```

| field | default | meaning |
|---|---|---|
| `romId` | required | from `rom.list.ok`, or cached from a previous run |
| `encoding` | `"binary"` | `"binary"` or `"base64"`, see section 7 |
| `chunkBytes` | 32768 | requested payload size; the bridge clamps it and tells you the real value in `rom.begin` |
| `ackEvery` | 0 | 0 streams continuously; N pauses after every N chunks until you ack, see section 8 |

`chunkBytes` is clamped to `[4096, 65516]` for binary and `[4096, 47000]` for base64. Always
allocate from the `chunkBytes` and `chunkCount` in `rom.begin`, never from what you asked for.

Then `chunkCount` chunks arrive, then:

```json
<-- { "type": "rom.end", "transferId": 1,
      "romId": "ea9bcae617fdf159b045185467ae58b2e4a48b9a",
      "sha1": "ea9bcae617fdf159b045185467ae58b2e4a48b9a",
      "crc32": "9f7fdd53",
      "sizeBytes": 1048576, "chunkCount": 32, "elapsedMs": 1 }
```

**Verify before you bake.** Compute CRC-32 over the reassembled buffer first: it is cheap,
and it catches a truncated or misassembled transfer in a millisecond. Then compute SHA-1
and check it against `rom.end.sha1` — you need the SHA-1 anyway, because it is what selects
the symbol table. If either disagrees, discard the buffer and ask again; do not decode.

To stop a transfer early:

```json
--> { "type": "rom.cancel", "transferId": 1 }
<-- { "type": "rom.cancelled", "transferId": 1, "reason": "cancelled by the lens" }
```

Cancellation takes effect between chunks, so expect up to one more chunk after you send it.

---

## 7. Chunk encodings

### 7.1 Binary (default, recommended)

Every binary frame is one chunk, self describing, with a 20 byte little endian header:

| offset | size | field | notes |
|---|---|---|---|
| 0 | 4 | magic | ASCII `PAR1` = `50 41 52 31` |
| 4 | 1 | version | `1` |
| 5 | 1 | kind | `1` = ROM chunk, `2` = save chunk |
| 6 | 2 | transferId | uint16, matches `rom.begin.transferId` |
| 8 | 4 | chunkIndex | uint32, zero based |
| 12 | 4 | chunkCount | uint32 |
| 16 | 4 | byteOffset | uint32, offset of this payload in the whole file |
| 20 | .. | payload | `frameLength - 20` bytes |

**All multi-byte fields are little endian.** With a `DataView`, pass `true` as the
`littleEndian` argument. This matches the Game Boy and the rest of the Pocket Diorama codebase.

Chunk 0 of a real Pokemon Red transfer, first 24 bytes:

```
50 41 52 31 01 01 01 00 00 00 00 00 20 00 00 00 00 00 00 00 | ff 00 00 00
P  A  R  1  v1 rom tid=1  idx=0        cnt=32     off=0     | payload...
```

Write the payload at `byteOffset`, not at `chunkIndex * chunkBytes`. They agree today, but
the offset is authoritative and costs you nothing.

In Lens Studio a binary frame arrives as a `Blob`:

```typescript
socket.binaryType = "blob";
socket.onmessage = async (event) => {
  if (typeof event.data === "string") { this.onJson(JSON.parse(event.data)); return; }
  const bytes = await event.data.bytes();   // Uint8Array
  this.onChunk(bytes);
};
```

Because `bytes()` is async, two chunks can be in flight inside your handler at once. Read
the header before you await anything, or keep a queue — the header tells you where the
payload belongs, so out of order completion is harmless as long as you use `byteOffset`.

### 7.2 Base64 (fallback)

Ask for `"encoding": "base64"` and chunks arrive as ordinary JSON text frames instead:

```json
<-- { "type": "rom.chunk", "transferId": 1, "chunkIndex": 0, "chunkCount": 32,
      "byteOffset": 0, "byteLength": 32768, "data": "/wAAAAAAAAD/AAAAAAAAAP8AAAAAAAAA..." }
```

`data` is standard base64 with padding. This exists for a client whose binary path is
awkward; it moves about a third more bytes and costs you a decode. Prefer binary.

---

## 8. Flow control

TCP backpressure protects the socket, not your script. If decoding a chunk on the glasses
is slower than the wire, set `ackEvery` and the bridge pauses for you:

```json
--> { "type": "rom.get", "id": "a3", "romId": "ea9b...", "ackEvery": 4 }
```

After chunks 3, 7, 11, ... the bridge stops and waits for:

```json
--> { "type": "rom.ack", "transferId": 1, "chunkIndex": 3 }
```

Acking chunk N releases everything through N, so a single ack after a batch is enough, and
a late ack for an older chunk is harmless. If no ack arrives within 30 seconds the bridge
sends `E_TIMEOUT` and abandons the transfer.

Start with `ackEvery: 0`. Add pacing only if you measure a problem; a 1 MiB ROM over LAN is
a few dozen milliseconds of wire time.

---

## 9. Saves

A lens can push its battery save up so the user can back it up or edit it, and pull one
back down later. Saves are the only thing here the user cannot regenerate from their own
cartridge, so the bridge writes them atomically and never overwrites one.

### 9.1 Pushing a save up

```json
--> { "type": "save.put", "id": "a4",
      "romId": "ea9bcae617fdf159b045185467ae58b2e4a48b9a",
      "filename": "red.sav", "sizeBytes": 32768,
      "sha1": "58ad9eab5da9f9f9a6193b35568954158c0e0e07",
      "encoding": "binary", "chunkBytes": 32768 }

<-- { "type": "save.ready", "id": "a4", "uploadId": 1,
      "chunkBytes": 32768, "encoding": "binary" }
```

Then send the bytes as chunk frames with the same 20 byte header, `kind = 2` and
`transferId = uploadId`, and commit:

```json
--> [binary frame: header kind=2 transferId=1 chunkIndex=0 chunkCount=1 byteOffset=0, 32768 byte payload]

--> { "type": "save.commit", "id": "a5", "uploadId": 1 }

<-- { "type": "save.ok", "id": "a5", "saveId": "20260903-233802-8fc5df",
      "sha1": "58ad9eab5da9f9f9a6193b35568954158c0e0e07",
      "sizeBytes": 32768, "storedAt": "2026-09-03T21:38:02.063Z" }
```

The `sha1` you declared in `save.put` is checked against the assembled bytes. A mismatch,
or a byte count that does not add up, returns `E_UPLOAD_MISMATCH` and nothing is written.
Send `{"type":"save.abort","uploadId":1}` to walk away. Saves larger than 256 KiB are
refused; a Gen 1 SRAM image is 32768 bytes.

In base64 mode, send
`{"type":"save.chunk","uploadId":1,"chunkIndex":0,"byteOffset":0,"data":"..."}`
text frames instead of binary ones.

### 9.2 Listing and pulling saves down

```json
--> { "type": "save.list", "id": "a6", "romId": "ea9bcae617fdf159b045185467ae58b2e4a48b9a" }

<-- { "type": "save.list.ok", "id": "a6", "saves": [
      { "saveId": "20260903-233802-8fc5df",
        "romId": "ea9bcae617fdf159b045185467ae58b2e4a48b9a",
        "filename": "red.sav", "sizeBytes": 32768,
        "sha1": "58ad9eab5da9f9f9a6193b35568954158c0e0e07",
        "crc32": "31bcfd9a", "createdAt": "2026-09-03T21:38:02.063Z",
        "source": "lens" } ] }
```

`romId` on `save.list` is an optional filter. `source` is `"lens"` for a save the glasses
pushed and `"upload"` for one the user dropped into the browser UI.

`save.get` mirrors `rom.get` exactly, with chunks carrying `kind = 2`:

```json
--> { "type": "save.get", "id": "a7", "saveId": "20260903-233802-8fc5df", "encoding": "binary" }

<-- { "type": "save.begin", "id": "a7", "transferId": 2,
      "saveId": "20260903-233802-8fc5df",
      "sha1": "58ad9eab5da9f9f9a6193b35568954158c0e0e07", "crc32": "31bcfd9a",
      "sizeBytes": 32768, "chunkBytes": 32768, "chunkCount": 1,
      "encoding": "binary", "ackEvery": 0 }

<-- [binary chunk frames]

<-- { "type": "save.end", "transferId": 2, "saveId": "20260903-233802-8fc5df",
      "sha1": "58ad9eab5da9f9f9a6193b35568954158c0e0e07", "crc32": "31bcfd9a",
      "sizeBytes": 32768, "chunkCount": 1, "elapsedMs": 0 }
```

---

## 10. Other messages

### Keepalive

```json
--> { "type": "ping", "id": "k1" }
<-- { "type": "pong", "id": "k1", "serverTime": 1788478568483 }
```

The bridge also sends WebSocket protocol level pings every 20 seconds and closes a
connection that misses two. Most stacks answer those for you. The JSON `ping` above exists
for stacks that hide protocol pings — Lens Studio's does.

### Library changed

If the user adds or removes a ROM while you are connected:

```json
<-- { "type": "event", "event": "library.changed", "roms": [ ... ] }
```

Unsolicited, no `id`, and the `roms` array is exactly what `rom.list` would return.

---

## 11. Errors

```json
<-- { "type": "error", "id": "a5", "code": "E_UNKNOWN_ROM",
      "message": "no rom with id 0000000000000000000000000000000000000000" }
```

`code` is stable and safe to branch on. `message` is for humans and may change.

| code | meaning | what to do |
|---|---|---|
| `E_BAD_MESSAGE` | malformed JSON, or a required field is missing | fix the client |
| `E_UNSUPPORTED` | unknown message type, or a binary frame that is not a save chunk | fix the client |
| `E_NOT_PAIRED` | you skipped pairing | send `pair` |
| `E_BAD_CODE` | wrong pairing code | ask the user to read the code again |
| `E_RATE_LIMIT` | three wrong codes; the socket is closing | reconnect and try once more |
| `E_UNKNOWN_ROM` | no ROM with that id | list again; the user may have removed it |
| `E_ROM_UNVERIFIED` | the file exists but is not a canonical cartridge | tell the user their dump does not match a known revision |
| `E_UNKNOWN_SAVE` | no save with that id | list again |
| `E_BUSY` | a transfer is already running on this connection | wait for `rom.end`, or cancel first |
| `E_UNKNOWN_TRANSFER` | that `transferId` or `uploadId` is not live | drop your local state for it |
| `E_UPLOAD_MISMATCH` | declared size or SHA-1 does not match the bytes | recompute and retry |
| `E_TOO_LARGE` | the frame or the declared save exceeds a limit | send less |
| `E_TIMEOUT` | you asked for pacing and did not ack | retry with `ackEvery: 0` |
| `E_INTERNAL` | the bridge failed on its own side | show the message; the terminal has more |

One transfer and one save upload run per connection at a time. Anything else is `E_BUSY`,
deliberately: a second concurrent transfer sharing one progress bar is much harder to debug
from inside a headset than an explicit refusal.

---

## 12. A complete client, in outline

```typescript
socket.onopen = () => send({ type: "pair", id: "1", code: userTypedCode,
                             client: { name: "Pocket Diorama", platform: "spectacles" } });

socket.onmessage = (event) => {          // ONE handler, installed here, never replaced
  if (typeof event.data !== "string") { onChunkBlob(event.data); return; }
  const message = JSON.parse(event.data);
  switch (message.type) {
    case "hello":        this.capabilities = message.capabilities;      break;
    case "paired":       send({ type: "rom.list", id: "2" });           break;
    case "rom.list.ok":  this.pick(message.roms);                       break;
    case "rom.begin":    this.buffer = new Uint8Array(message.sizeBytes);
                         this.expect = message;                        break;
    case "rom.end":      this.finish(message);                          break;
    case "error":        this.showError(message.code, message.message); break;
  }
};

// chunk handler: read the header, write at byteOffset, update the progress bar
// finish(): crc32 -> sha1 -> compare with message.sha1 -> only then bake
```

---

## 13. Versioning

`protocolVersion` increments only on a breaking change. Additive fields are not breaking:
ignore fields you do not know, and do not fail on an unexpected message type — log it and
carry on.

The bridge is a provisioning tool. Once the lens has baked its world into persistent
storage, it must never need this server again. If your client cannot start without a
bridge on the network, the client has a bug.
