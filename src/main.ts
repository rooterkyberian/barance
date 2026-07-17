import { initPhysics } from './sim';
import { Game } from './game';

async function main(): Promise<void> {
  await initPhysics();
  const game = new Game();
  // Debug/testing handle: window.bl.grabFromTray(25), .placeHand('R', 0), .advance(2)…
  (window as Window & { bl?: Game }).bl = game;
  game.start();
}

void main();
