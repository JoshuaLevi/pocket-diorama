# The world bridge the lens actually talks to

Serves a baked world bundle to the lens over a WebSocket, on `0.0.0.0:8781`.

```
node tools/devserver/serve.mjs Assets/Generated/kanto.json
```

**RESTART IT AFTER EVERY BAKE.** The bundle is read ONCE, at startup, and held in
memory for the life of the process. On 7 September this server had been up since
16:38 while the bundle gained its sound banks at 17:27, so the glasses were
handed a stale world all evening and the silence was read as an audio bug for
hours. The startup line prints the char count and sha1 of what is actually being
served; compare it with the file if anything looks older than it should.

## This is not retired

This file used to say it was, and that "nothing depends on it". Both were wrong,
and on 10 September that cost half an hour: the lens's `BridgeWorldSource` speaks
THIS protocol -- `hello` / `catalog` / `getBundle` / `bundleStart` / `chunk` /
`bundleEnd` -- and it is what every "Receiving world 92%" in the device log comes
from.

`bridge/` is a different thing on the same port. It carries **ROMs**, with
pairing and its own binary `PAR1` framing, and the lens speaks it from
`Assets/Scripts/world/RomBridge.ts`. The two cannot run at once, because they
both want 8781.

## Flow control

The bundle goes out with `socket.write` backpressure respected -- `sendSlowly`
waits for `drain`. That is not decoration. Without it, 103 chunks (1.7 MB) left
here in 471 ms, which is 3.6 MB/s at a headset, and two frames near the end of
that burst reached the lens truncated:

    17:44:25.188  bad frame from bridge: 10964 chars starting stWarp":1},{"x":11,"

Both started mid-JSON: a receiver whose framing had come apart. A WebSocket that
has lost framing does not recover -- every byte after it is read at the wrong
offset -- so the rest of the bundle and the `bundleEnd` that would have completed
it were gone, and the wearer sat on 92% with no error to show for it.

The two answers before this one were "make the chunks smaller": 48 KiB failed on
7 September, 16 KiB failed on 10 September. The size was never the problem.
