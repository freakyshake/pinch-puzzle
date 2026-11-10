# Watching the game play itself (emulator autoplay)

The game can be driven from the terminal. A script moves the emulated right
hand: it pinches each piece, carries it to its matching slot and lets go. You
watch it happen in the browser window. This is useful to:

- see a board, or all six, solved without wrestling the emulator controls;
- check quickly that nothing broke after a code change;
- record demo footage for the video.

Some background terms:

- **IWER** is the VR headset emulator built into IWSDK. It pretends to be a
  Quest 3 inside the browser.
- **The IWSDK CLI** (`npx iwsdk ...`) talks to the running page. It can enter
  VR, move the emulated head and hands, and read game state.
- **ECS** (entity-component system) is how the game is organised. Every piece
  and slot is an *entity* with a name such as `piece-cube` or `slot-cone`.
  Repeated shapes get a number: `piece-cone-2`.

See also: https://iwsdk.dev/guides/02-testing-experience.html

## 1. Start the dev server (once per session)

```powershell
cd D:\Projects\metavr\web\pinch-puzzle
npm run dev
```

This opens a browser window controlled by the CLI (the "managed window") on
`https://localhost:8081`. Leave it open and visible, because that is where you
watch the game. Check that it is ready:

```powershell
npx iwsdk dev status
```

Look for `"browserCommandReady": true`. If you closed the window by accident,
bring it back with:

```powershell
npx iwsdk runtime recover
```

## 2. Run the autoplay script

Open a second terminal in the project folder:

| Command | What it does |
|---|---|
| `node scripts/autoplay.mjs` | Solve the board currently on the table |
| `node scripts/autoplay.mjs --wrong` | Drop one piece on a wrong slot first (it glides back), then solve |
| `node scripts/autoplay.mjs --boards 3` | Solve the next three boards in a row |
| `node scripts/autoplay.mjs --all` | Solve six boards, the full run |
| `node scripts/autoplay.mjs --slow` | Slower hand moves, easier to follow or film |

Flags combine, for example `node scripts/autoplay.mjs --all --slow`.

What the script does each time:

1. Enters VR if needed (as if you clicked Enter XR), then switches input to
   hands.
2. Reads the board: which pieces are still on the tray, and where each slot
   is.
3. For each loose piece, runs one hand sequence: approach, pinch, carry above
   the matching slot, release, wait.
4. Prints the progress panel after each piece, for example
   `piece-cube -> slot-cube [1 of 3 placed]`.
5. When the board is solved, waits for the next one and carries on.

The CLI is slower than the game. The roughly 3-second "Solved!" moment is often
over before the script looks, so sometimes you see it only in the window. That
is expected.

## 3. Doing it by hand, one command at a time

These are the same building blocks the script uses. They are handy when you
want to test one specific thing. They work as written in PowerShell 7 and in Git Bash.

Enter VR and switch to hands:

```powershell
npx iwsdk xr enter --input-json '{}'
npx iwsdk xr set-input-mode --input-json '{"mode":"hand"}'
```

List what is on the table (names of pieces and slots):

```powershell
npx iwsdk ecs find --input-json '{"withComponents":["Piece"]}'
npx iwsdk ecs find --input-json '{"withComponents":["Slot"]}'
```

Each result has an `entityIndex`. Query one to see its state and position:

```powershell
npx iwsdk ecs query --input-json '{"entityIndex":25}'
```

- A piece's `Piece.state` is `tray`, `held`, `returning`, `snapping` or
  `placed`.
- A slot's `Transform.position` is where the hand should carry its piece.
  Carry it about 0.1 m above that point.

Pinch a piece, carry it, let go. Here the cube goes to its board 1 slot:

```powershell
npx iwsdk xr run-sequence --timeout 45000 --input-json '{"device":"hand-right","steps":[{"target":"piece-cube","approach":{"distance":0.06},"pinch":{"value":1,"at":"arrival"}},{"position":{"x":0.18,"y":0.88,"z":-0.63},"duration":0.7},{"pinch":0,"duration":0.15},{"duration":0.6}]}'
```

Reading the steps:

- `target` plus `approach` move the hand to the named piece.
- `pinch value 1 at arrival` closes the fingers when the hand gets there. The
  game sees this as a grab.
- `position` carries the hand, and the piece with it, to a point in meters.
- `pinch 0` opens the fingers. The game then snaps the piece or sends it home.
- The last step just waits so the glide animation can finish.

Read the progress panel text:

```powershell
npx iwsdk ecs find --input-json '{"namePattern":"^Progress Panel$"}'
npx iwsdk ui inspect --input-json '{"entityIndex":16,"selector":"#placed-text"}'
```

The panel's element IDs are `board-label`, `board-name`, `placed-text`,
`bar-fill` and `step-1` to `step-6`.

Other useful commands:

| Command | Purpose |
|---|---|
| `npx iwsdk browser screenshot --output-file artifacts/shot.png` | Save what the window shows |
| `npx iwsdk browser reload --input-json '{}'` | Restart the game at board 1 |
| `npx iwsdk xr exit` | Leave VR back to the flat page |
| `npx iwsdk dev down` | Stop the dev server |

## 4. Troubleshooting

- **`browser_not_launched` or `browserCommandReady: false`**: the managed
  window is closed. Run `npx iwsdk runtime recover`.
- **"piece(s) did not lock in"**: the hand let go too far from the slot twice (the
  game snaps within 10 cm). Run the script again; it only moves pieces still
  on the tray.
- **Nothing moves**: check `npx iwsdk xr status` shows `"sessionActive": true`.
  If not, run `npx iwsdk xr enter --input-json '{}'`.
- **After editing code**: the page hot-reloads and the game restarts at
  board 1, outside VR. Just run the script again.

## 5. Shortcuts for testing and filming

- **Start on a later board:** add `?board=N` to the address, for example
  `https://localhost:8081/?board=6`. It is handy for testing the final board,
  or for recording a specific board for the video. It also skips the ghost-hand
  intro.
- **Seated view in the emulator:** the default emulated head is at standing
  height. To see the table the way a seated player does:

  ```powershell
  npx iwsdk xr set-transform --input-json '{"device":"headset","position":{"x":0,"y":1.2,"z":0.05}}'
  npx iwsdk xr look-at --input-json '{"device":"headset","target":{"x":0,"y":0.85,"z":-0.6}}'
  ```

- **Comfort panel buttons from the CLI:** the emulator's fingertip poke is
  unreliable on this angled panel. A controller ray click is reliable:

  ```powershell
  npx iwsdk xr set-input-mode --input-json '{"mode":"controller"}'
  npx iwsdk xr list-targets    # find the button's position, e.g. height-up
  npx iwsdk xr look-at --input-json '{"device":"controller-right","target":{"x":-0.51,"y":1.04,"z":-0.30}}'
  npx iwsdk xr select --input-json '{"device":"controller-right","duration":0.2}'
  ```

  Button names are `height-down`, `height-up`, `move-closer`, `move-farther`,
  `contrast-toggle`, `music-toggle`, `restart-board` and `reset-settings`.
  The Play again button on the progress panel is `play-again`.
