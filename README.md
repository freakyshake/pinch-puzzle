# Pinch Puzzle

A calm, seated, hands-only tabletop puzzle for Meta Quest, built with the
Immersive Web SDK (IWSDK) and WebXR. It runs in the Quest Browser with no
install.

**Play:** https://freakyshake.github.io/pinch-puzzle/ (open in the Quest
Browser, then press Enter XR).

## How to play
Shapes rest on a tray in front of you. Pinch one with your thumb and index
finger, carry it to the ring with the same shape and colour, and let go. It
snaps in with a note. A wrong ring sends the piece gently back to the tray.
Fill every ring to solve the board. There are six boards, from 3 pieces to 8.

A see-through hand shows the pinch on the first board, so no reading is
needed to start.

## Designed for comfort and access
- Hands only. Controllers are never needed, and one hand is always enough.
- Seated. Everything sits within easy reach of a chair.
- No timers and no fail states.
- Shape and colour together. No piece relies on colour alone.
- A Comfort panel moves the table up, down, closer or farther, and turns on
  high contrast and music. Your choices are remembered.

## Run it locally
Requires Node 20.19+, 22.12+ or 24+.

```sh
npm install
npm run dev     # opens the game with the built-in XR emulator
npm run build   # static production build in dist/
```

## Built with
- [Immersive Web SDK](https://iwsdk.dev) (ECS, hand-pinch grabbing, spatial
  UI, positional audio)
- All sounds are synthesised by `scripts/make-sounds.mjs`; all 3D shapes are
  built in code.
