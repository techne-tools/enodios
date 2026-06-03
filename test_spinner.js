const HELIX_FRAMES = ['⢌⣉⢎⣉', '⣉⡱⣉⡱', '⣉⢎⣉⢎', '⡱⣉⡱⣉'];
let frame = 0;
setInterval(() => {
  process.stdout.write('\r' + HELIX_FRAMES[frame]);
  frame = (frame + 1) % HELIX_FRAMES.length;
}, 80);
