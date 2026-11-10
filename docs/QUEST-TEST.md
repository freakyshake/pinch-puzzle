# Real Quest test checklist (about 15 minutes)

The emulator proves the logic. Only a real headset proves that hand tracking,
reach, comfort, sound and frame rate feel right. Do this once, ideally by
Nov 14, and note the answers.

## Setup (local Wi-Fi, no publishing needed)
On the laptop, in PowerShell:

```powershell
cd D:\Projects\metavr\web\pinch-puzzle
npm run dev                    # leave this window running
```

In a second PowerShell window:

```powershell
cd D:\Projects\metavr\web\pinch-puzzle
npx iwsdk dev status           # note the address under runtimeUrls.network
```

It looks like `https://192.168.x.x:8081/`. Then:

1. Make sure the laptop and the Quest are on the same Wi-Fi, and keep the
   laptop plugged in and awake. If Windows asks whether Node.js may use the
   network, allow **Private networks**.
2. Put on the Quest, sit on a chair, and put the controllers down.
3. Open the Quest Browser and type the address (with `https://` and `:8081`).
4. You will see a certificate warning, because the dev server signs its own
   certificate. Choose **Advanced**, then **Proceed**. This is expected on a
   local network.
5. Press **Enter XR** on the panel (point and pinch, or poke it). Allow hand
   tracking if the Quest asks.

If the page never loads: check that both devices are on the same network
(guest networks often block devices from seeing each other), and that the
address is the `network` one, not `localhost`.

Once the game is published, use the hosted link instead and skip the
certificate step.

## Try each of these and note what happened

| # | Do this | Expected | OK? / notes |
|---|---|---|---|
| 1 | Just watch for 10 seconds | A see-through hand shows how to pinch a piece and drop it on its ring | |
| 2 | Pinch the cube with thumb and index finger, move it, let go over the orange cube ring | Short blip on pinch; piece glides in, plays a note, pulses, locks | |
| 3 | Drop a piece on a wrong ring | Soft low "bonk", the ring dims, the piece floats back to the tray | |
| 4 | While holding a piece, look at the rings | The matching ring pulses brighter | |
| 5 | Finish board 1 | Chime, green "Solved!" panel, board 2 appears after about 3 s | |
| 6 | Comfort panel (left): poke Lower / Higher, Closer / Farther | Table, pieces and panel move in 4 to 5 cm steps | |
| 7 | Comfort panel: High contrast On | Dark mat, black outlines on pieces, brighter rings | |
| 8 | Comfort panel: Music Off / On | Ambient music stops and starts | |
| 9 | Play all six boards | Board 6 shows "All solved!" and a Play again button | |
| 10 | Press the Quest button, then come back | Game is still where you left it | |
| 11 | Exit to Browser on the panel | Leaves VR cleanly | |

## Also tell me
- Could you reach every piece and ring while seated, without leaning? Which
  ones were hard?
- Did any pinch fail to pick up, or drop a piece too early?
- Any stutter or lag? (Rough is fine: smooth / slight / bad.)
- Was any text hard to read?
- Was the sound volume comfortable?
- Did anything confuse you in the first minute?
